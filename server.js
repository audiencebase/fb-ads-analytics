// server.js - Facebook Ads Analytics Data Pipeline

require('dotenv').config(); // Load environment variables
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const cron = require('node-cron');

// Initialize Express
const app = express();
app.use(express.json());

// Set up Supabase client using environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Facebook API credentials from environment variables
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;

// Function to get Facebook Ad Accounts
async function getAdAccounts() {
  try {
    console.log('Fetching your Facebook Ad Accounts...');
    
    const url = 'https://graph.facebook.com/v18.0/me/adaccounts';
    
    const response = await axios.get(url, {
      params: {
        access_token: FB_ACCESS_TOKEN,
        fields: 'id,name,account_status'
      }
    });
    
    if (response.data && response.data.data) {
      console.log('Found Ad Accounts:');
      response.data.data.forEach(account => {
        console.log(`- ${account.name} (${account.id})`);
      });
      return response.data.data;
    } else {
      console.log('No ad accounts found or unexpected response format');
      console.log(response.data);
      return [];
    }
  } catch (error) {
    console.error('Error fetching ad accounts:', error.response?.data || error.message);
    return [];
  }
}

// Function to fetch Facebook Ad data for a specific account
async function fetchFacebookAdData(adAccountId) {
  try {
    console.log(`Fetching data for ad account: ${adAccountId}`);
    
    // Get date range (last 7 days)
    const today = new Date();
    const endDate = today.toISOString().split('T')[0];
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 7);
    const startDateStr = startDate.toISOString().split('T')[0];
    
    // Prepare the date range for the API
    const timeRange = JSON.stringify({ since: startDateStr, until: endDate });
    
    // First, let's get the campaigns to identify funnels
    const campaignsUrl = `https://graph.facebook.com/v18.0/${adAccountId}/campaigns`;
    
    const campaignsResponse = await axios.get(campaignsUrl, {
      params: {
        access_token: FB_ACCESS_TOKEN,
        fields: 'id,name,status',
        limit: 1000
      }
    });
    
    console.log(`Found ${campaignsResponse.data.data.length} campaigns`);
    
    // Now get insights for these campaigns
    const insightsUrl = `https://graph.facebook.com/v18.0/${adAccountId}/insights`;
    
    const insightsResponse = await axios.get(insightsUrl, {
      params: {
        access_token: FB_ACCESS_TOKEN,
        time_range: timeRange,
        level: 'campaign',
        fields: 'campaign_id,campaign_name,spend,impressions,reach,clicks,ctr,cost_per_inline_link_click,frequency',
        limit: 1000
      }
    });
    
    console.log(`Retrieved insights for ${insightsResponse.data.data.length} campaigns`);
    
    // Map the campaigns to their insights data
    const campaignData = insightsResponse.data.data;
    const campaignMap = {};
    
    campaignsResponse.data.data.forEach(campaign => {
      campaignMap[campaign.id] = campaign.name;
    });
    
    // Group insights by funnel (if possible)
    const funnelData = {};
    
    for (const insight of campaignData) {
      // Try to extract funnel information from campaign name
      const campaignName = insight.campaign_name || campaignMap[insight.campaign_id] || 'Unknown Campaign';
      const funnelMatch = campaignName.match(/Funnel\s*(\d+)/i);
      const funnelId = funnelMatch ? funnelMatch[1] : 'unknown';
      const funnelName = `Funnel #${funnelId}`;
      
      // Initialize funnel data if it doesn't exist
      if (!funnelData[funnelId]) {
        funnelData[funnelId] = {
          funnel_id: funnelId,
          funnel_name: funnelName,
          start_date: startDateStr,
          end_date: endDate,
          amount_spent: 0,
          impressions: 0,
          reach: 0,
          ads_link_clicks: 0,
          frequency: 0,
          campaigns: []
        };
      }
      
      // Add this campaign's data to the funnel totals
      funnelData[funnelId].amount_spent += parseFloat(insight.spend || 0);
      funnelData[funnelId].impressions += parseInt(insight.impressions || 0);
      funnelData[funnelId].reach += parseInt(insight.reach || 0);
      funnelData[funnelId].ads_link_clicks += parseInt(insight.clicks || 0);
      
      // Keep track of campaign-level data for reference
      funnelData[funnelId].campaigns.push({
        campaign_id: insight.campaign_id,
        campaign_name: campaignName,
        spend: parseFloat(insight.spend || 0),
        impressions: parseInt(insight.impressions || 0),
        clicks: parseInt(insight.clicks || 0)
      });
    }
    
    // Calculate aggregate metrics
    for (const funnelId in funnelData) {
      const funnel = funnelData[funnelId];
      if (funnel.reach > 0) {
        funnel.frequency = funnel.impressions / funnel.reach;
      }
      if (funnel.impressions > 0) {
        funnel.link_ctr = (funnel.ads_link_clicks / funnel.impressions) * 100;
      }
      
      // Make the data ready for the database
      delete funnel.campaigns; // Remove the campaigns array as it's not in our DB schema
    }
    
    return Object.values(funnelData);
  } catch (error) {
    console.error('Error fetching Facebook data:', error.response?.data || error.message);
    return [];
  }
}

// Function to save funnel data to Supabase
async function saveFunnelData(funnelDataArray) {
  if (!funnelDataArray || funnelDataArray.length === 0) {
    console.log('No funnel data to save');
    return;
  }
  
  try {
    console.log(`Saving data for ${funnelDataArray.length} funnels to Supabase...`);
    
    for (const funnelData of funnelDataArray) {
      // Mark this as the current week
      funnelData.is_current_week = true;
      
      // Insert or update the funnel_analytics table
      const { data, error } = await supabase
        .from('funnel_analytics')
        .upsert([funnelData], {
          onConflict: 'start_date,end_date,funnel_id',
          returning: 'minimal'
        });
      
      if (error) {
        console.error(`Error saving data for ${funnelData.funnel_name}:`, error);
      } else {
        console.log(`Saved data for ${funnelData.funnel_name}`);
      }
    }
    
    console.log('All funnel data saved successfully!');
  } catch (error) {
    console.error('Error saving funnel data:', error);
  }
}

// Main function to orchestrate the entire process
async function processFacebookData() {
  try {
    // Step 1: Get ad accounts
    const adAccounts = await getAdAccounts();
    
    if (adAccounts.length === 0) {
      console.log('No ad accounts found. Cannot proceed.');
      return;
    }
    
    // Step 2: For each ad account, fetch and process data
    for (const account of adAccounts) {
      // Skip inactive accounts
      if (account.account_status !== 1) {
        console.log(`Skipping inactive account: ${account.name}`);
        continue;
      }
      
      const accountId = account.id.replace('act_', '');
      console.log(`Processing account: ${account.name} (${accountId})`);
      
      // Step 3: Fetch funnel data for this account
      const funnelData = await fetchFacebookAdData(`act_${accountId}`);
      
      // Step 4: Save the data to Supabase
      await saveFunnelData(funnelData);
    }
    
    console.log('Facebook data sync completed!');
  } catch (error) {
    console.error('Error in processing Facebook data:', error);
  }
}

// Schedule the data fetch to run daily at 1 AM
cron.schedule('0 1 * * *', () => {
  console.log('Running scheduled Facebook data sync...');
  processFacebookData();
});

// Endpoint to manually trigger data fetch
app.post('/sync-facebook-data', async (req, res) => {
  try {
    console.log('Manual sync triggered');
    await processFacebookData();
    res.json({ success: true, message: 'Facebook data sync completed' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test endpoint to check API connection
app.get('/test-facebook-connection', async (req, res) => {
  try {
    const adAccounts = await getAdAccounts();
    res.json({ 
      success: true, 
      message: 'Successfully connected to Facebook API', 
      adAccounts 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Basic home route
app.get('/', (req, res) => {
  res.send(`
    <h1>Facebook Ads Analytics API</h1>
    <p>Available endpoints:</p>
    <ul>
      <li><a href="/test-facebook-connection">Test Facebook Connection</a></li>
      <li>POST to /sync-facebook-data to trigger data sync</li>
    </ul>
  `);
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Visit http://localhost:3000/test-facebook-connection to test your Facebook connection');
});
