import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = 'https://zwszhrmxntqfjvontcfw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp3c3pocm14bnRxZmp2b250Y2Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0OTI3OTUsImV4cCI6MjA4OTA2ODc5NX0.2n9bv8l_ehOm26CSezVV8-Cwh5iqWfE9exPVjpuq9U8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
