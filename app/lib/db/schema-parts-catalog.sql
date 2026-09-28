-- Parts catalog table for SKU lookup in order sheets
-- Imported from Steele's pricing Excel file

CREATE TABLE IF NOT EXISTS parts_catalog (
  id BIGSERIAL PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  cost DECIMAL(10, 2) NOT NULL,
  retail_price DECIMAL(10, 2) NOT NULL,
  category TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable RLS but allow anon read access for parts lookup in order sheets
ALTER TABLE parts_catalog ENABLE ROW LEVEL SECURITY;

-- Allow anon users to read the catalog (needed for order sheet component)
CREATE POLICY "Allow anon read" ON parts_catalog
  FOR SELECT TO anon
  USING (true);

-- Allow authenticated users to read the catalog
CREATE POLICY "Allow authenticated read" ON parts_catalog
  FOR SELECT TO authenticated
  USING (true);

-- Allow admin users to manage the catalog
CREATE POLICY "Allow admin manage" ON parts_catalog
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Create index on SKU for fast lookup
CREATE INDEX IF NOT EXISTS idx_parts_catalog_sku ON parts_catalog(sku);

-- Create index on category for filtering
CREATE INDEX IF NOT EXISTS idx_parts_catalog_category ON parts_catalog(category);
