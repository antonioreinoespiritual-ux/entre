import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://oxlhgpoiegrdzohnwhfn.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94bGhncG9pZWdyZHpvaG53aGZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5ODEyNTQsImV4cCI6MjA4NzU1NzI1NH0.JHr_DKogvT9V909RUpeDaOY0Aq7KCBjdRxj_FU3YqrQ';

const customSupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

export default customSupabaseClient;

export { 
    customSupabaseClient,
    customSupabaseClient as supabase,
};
