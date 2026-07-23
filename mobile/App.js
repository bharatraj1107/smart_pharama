/**
 * App.js — root entry point for Smart Pharma Mobile (Expo)
 *
 * Responsibilities:
 *  1. Wrap everything in SafeAreaProvider (required by react-native-safe-area-context)
 *  2. Wrap everything in GestureHandlerRootView (required by react-native-gesture-handler / Drawer)
 *  3. Provide the AuthContext (session state + signIn / signOut)
 *  4. Render AppNavigator which shows Auth stack or Main Drawer based on session
 */
import 'react-native-gesture-handler'; // ← must be the FIRST import
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/navigation/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="light" backgroundColor="#1a56db" />
          <AppNavigator />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
