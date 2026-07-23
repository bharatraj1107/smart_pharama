import React, { useState, useContext } from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthContext } from '../navigation/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import ScreenWrapper from '../components/ScreenWrapper';
import { Card, CardTitle, Btn, Badge } from '../components/ui';
import { colors, spacing, fontSize, pageStyles } from '../styles/theme';

export default function SettingsScreen() {
  const { signOut, session } = useContext(AuthContext);
  const { role }             = usePermissions();

  const [notifications, setNotifications] = useState({
    tasks:         true,
    schedule:      true,
    announcements: true,
  });

  const toggle = (key) => {
    const next = { ...notifications, [key]: !notifications[key] };
    setNotifications(next);
    AsyncStorage.setItem(`notify_${key}`, JSON.stringify(next[key]));
  };

  const Row = ({ label, value, onToggle }) => (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={value ? '#fff' : '#f4f3f4'}
      />
    </View>
  );

  return (
    <ScreenWrapper>
      <View style={pageStyles.header}>
        <Text style={pageStyles.title}>⚙️ Settings</Text>
        <Text style={pageStyles.subtitle}>Manage personal preferences.</Text>
      </View>

      {/* Account info */}
      <Card style={{ marginBottom: spacing[4] }}>
        <CardTitle>Account</CardTitle>
        <View style={s.row}>
          <Text style={s.rowLabel}>{session?.name || 'User'}</Text>
          <Badge variant="primary" label={role.toUpperCase()} />
        </View>
        {session?.companyName && (
          <Text style={{ fontSize:fontSize.sm, color:colors.textMuted, marginTop:spacing[1] }}>
            {session.companyName}
          </Text>
        )}
      </Card>

      {/* Notifications */}
      <Card style={{ marginBottom: spacing[4] }}>
        <CardTitle>Notifications</CardTitle>
        <Row label="Task updates"           value={notifications.tasks}         onToggle={() => toggle('tasks')} />
        <Row label="Schedule changes"       value={notifications.schedule}      onToggle={() => toggle('schedule')} />
        <Row label="Company announcements"  value={notifications.announcements} onToggle={() => toggle('announcements')} />
      </Card>

      {/* API endpoint reminder */}
      <Card style={{ marginBottom: spacing[4] }}>
        <CardTitle>Network</CardTitle>
        <Text style={{ fontSize:fontSize.sm, color:colors.textMuted, lineHeight:20 }}>
          The mobile app connects to your Express backend over your local Wi-Fi network.
          {'\n\n'}
          Edit <Text style={{ fontFamily:'monospace', color:colors.primary }}>src/config.js</Text> and replace the IP address with your laptop's current IPv4 address if connectivity fails.
        </Text>
      </Card>

      {/* Sign out */}
      <Btn label="🚪 Sign Out" onPress={signOut} variant="danger" block size="lg" />
    </ScreenWrapper>
  );
}

const s = StyleSheet.create({
  row:      { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingVertical:spacing[3], borderBottomWidth:1, borderBottomColor:colors.border },
  rowLabel: { fontSize:fontSize.base, color:colors.text, fontWeight:'500' },
});
