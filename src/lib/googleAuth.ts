import { GoogleSignin } from '@react-native-google-signin/google-signin';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

// Configure Google Sign-In
export const configureGoogleSignIn = () => {
  GoogleSignin.configure({
    webClientId: '1067695067282-vuh6jki8rl2ao8k4vnjo3t2v2hlm003p.apps.googleusercontent.com', // Web OAuth client ID from Google Console
    offlineAccess: false,
  });
};

export const signInWithGoogle = async () => {
  try {
    // Check if device supports Google Play Services
    await GoogleSignin.hasPlayServices();
    
    // Add a small delay to ensure activity is ready
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Sign in with Google
    const userInfo = await GoogleSignin.signIn();
    
    if (!userInfo.data?.idToken) {
      throw new Error('No ID token received from Google Sign-In');
    }

    // Sign in to Supabase with the Google ID token
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: userInfo.data.idToken,
    });

    if (error) {
      throw error;
    }

    // Automatically save user's name from Google to profile (only for new users)
    if (data.user && userInfo.data.user) {
      const googleUser = userInfo.data.user;
      const fullName = googleUser.name || googleUser.givenName || '';
      
      if (fullName) {
        // Check if profile already exists with a name
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id, full_name')
          .eq('id', data.user.id)
          .single();

        // Only create profile if it doesn't exist or has no name
        // Don't overwrite existing user-set names
        if (!existingProfile || !existingProfile.full_name) {
          await supabase
            .from('profiles')
            .upsert({
              id: data.user.id,
              full_name: fullName,
              updated_at: new Date().toISOString(),
            });
        }
      }
    }

    // Save session to AsyncStorage for background tasks
    if (data.session) {
      await AsyncStorage.setItem('supabase.auth.token', JSON.stringify({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      }));
    }

    return { data, error: null };
  } catch (error) {
    console.error('Google Sign-In error:', error);
    
    // Handle specific error cases
    if (error instanceof Error) {
      if (error.message.includes('Current activity is null')) {
        return { 
          data: null, 
          error: new Error('Please wait a moment and try again. The app is still initializing.')
        };
      }
    }
    
    return { data: null, error };
  }
};

export const signOutFromGoogle = async () => {
  try {
    await GoogleSignin.signOut();
    await supabase.auth.signOut();
  } catch (error) {
    console.error('Sign out error:', error);
  }
};
