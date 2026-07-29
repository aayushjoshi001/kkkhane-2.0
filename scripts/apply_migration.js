// Run this migration via Supabase service role key
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  'https://wwvuflbzacromudviaab.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3dnVmbGJ6YWNyb211ZHZpYWFiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTkyMzIxOSwiZXhwIjoyMDY3NDk5MjE5fQ.RR7vxnE1LFx6B8Up1tOF7yp4g5vhCzXi_8akjvkl0p8'
)

async function run() {
  const sql = `
    ALTER TABLE bookings
        ADD COLUMN IF NOT EXISTS custom_room_price numeric(12, 2) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS room_rate numeric(12, 2) DEFAULT NULL;
  `
  const { error } = await supabase.rpc('exec_sql', { query: sql }).catch(() => ({ error: 'rpc not available' }))
  
  if (error) {
    // Fallback: try raw REST
    console.log('RPC failed:', error)
    console.log('Trying direct insert to confirm connection...')
    
    // Test connection
    const { data, error: e2 } = await supabase.from('bookings').select('id').limit(1)
    if (e2) {
      console.error('Connection error:', e2)
    } else {
      console.log('Connected. Columns need to be added via Supabase SQL editor.')
      console.log('Run this SQL in the Supabase dashboard > SQL Editor:')
      console.log(sql)
    }
  } else {
    console.log('Migration applied successfully!')
  }
}

run()
