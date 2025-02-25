-- Main Identity Resolution table
CREATE TABLE identity_resolution (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name TEXT,
    last_name TEXT,
    -- ... all other fields as per schema provided earlier
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for multiple phone numbers
CREATE TABLE identity_phone_numbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id UUID REFERENCES identity_resolution(id) ON DELETE CASCADE,
    phone_number TEXT NOT NULL,
    phone_type TEXT,
    is_primary BOOLEAN DEFAULT false,
    verification_status TEXT,
    source TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for multiple email addresses
CREATE TABLE identity_email_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id UUID REFERENCES identity_resolution(id) ON DELETE CASCADE,
    email_address TEXT NOT NULL,
    email_type TEXT,
    is_primary BOOLEAN DEFAULT false,
    verification_status TEXT,
    source TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for landline/wireless numbers from skiptrace data
CREATE TABLE identity_skiptrace_numbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id UUID REFERENCES identity_resolution(id) ON DELETE CASCADE,
    phone_number TEXT NOT NULL,
    number_type TEXT,
    verification_status TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sha256 path tracking
CREATE TABLE identity_sha256_paths (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id UUID REFERENCES identity_resolution(id) ON DELETE CASCADE,
    sha256_path TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX idx_identity_resolution_emails ON identity_resolution(personal_email, business_email);
CREATE INDEX idx_identity_resolution_names ON identity_resolution(first_name, last_name);
CREATE INDEX idx_identity_resolution_company ON identity_resolution(company_name);
CREATE INDEX idx_identity_phone_numbers ON identity_phone_numbers(phone_number);
CREATE INDEX idx_identity_email_addresses ON identity_email_addresses(email_address);
CREATE INDEX idx_identity_resolution_updated ON identity_resolution(updated_at);
