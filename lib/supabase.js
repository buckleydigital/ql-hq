/**
 * Supabase client configuration for QuoteLeadsHQ.
 *
 * Usage (browser):
 *   import { supabase } from './lib/supabase.js';
 *
 * The anon key is safe to expose — Row Level Security enforces access.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://wjadekgptkstfdootuol.supabase.co';
const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqYWRla2dwdGtzdGZkb290dW9sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5OTc3NzQsImV4cCI6MjA5MDU3Mzc3NH0.g45wqe_F9KHh3TVzkq8LimxxT4UiuTZpJZcWkzzD7IM';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
