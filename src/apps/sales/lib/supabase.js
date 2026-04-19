import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://jbdtdyxzfejhotbjdnwm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpiZHRkeXh6ZmVqaG90YmpkbndtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5Mjg0MjAsImV4cCI6MjA5MTUwNDQyMH0.Yir9cjCiWwOF6ZVpGGNBeH7nmDx0twUX1TqiY9fAvlw';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
