import React, { useEffect, useState, useCallback, useContext } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { AuthContext } from '../navigation/AuthContext';
import API_BASE_URL from '../config';
import ScreenWrapper from '../components/ScreenWrapper';
import {
  Card, CardTitle, Badge, AlertBanner, Btn, Input,
  Spinner, EmptyState, TabBar, InfoRow,
} from '../components/ui';
import { colors, spacing, fontSize, pageStyles, roleBadgeVariant } from '../styles/theme';

const COMPANY_NAMES = {
  bharath:          'Bharath Enterprises',
  shree_ganaapathy: 'Shree Ganaapathy Roto Prints',
  vel:              'Vel Gravure',
};

function formatDate(str) {
  if (!str) return '—';
  try { return new Date(str).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }); }
  catch { return str; }
}

function Avatar({ name, size = 64 }) {
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: colors.primary,
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.4 }}>
        {(name || 'U').charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { session } = useContext(AuthContext);
  const token        = session?.token;
  const role         = session?.role || 'worker';
  const canViewStaff = ['admin','ceo'].includes(role);

  const TABS = [
    { key:'myprofile', label:'👤 My Profile' },
    ...(canViewStaff ? [{ key:'staff', label:'👥 Staff Directory' }] : []),
  ];
  const [activeTab, setActiveTab] = useState('myprofile');

  // Own profile
  const [profile,  setProfile]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [editForm, setEditForm] = useState({});
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');

  // Staff
  const [staff,       setStaff]       = useState([]);
  const [staffLoading,setStaffLoading]= useState(false);
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [search,      setSearch]      = useState('');

  const headers = { 'Content-Type':'application/json', Authorization: token };

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE_URL}/profile`, { headers:{ Authorization:token } });
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
        setEditForm({
          phone: data.phone||'', dob: data.dob||'', age: data.age||'',
          address: data.address||'', emergencyContact: data.emergencyContact||'',
          joiningDate: data.joiningDate||'',
        });
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [token]);

  const fetchStaff = useCallback(async () => {
    if (!canViewStaff) return;
    setStaffLoading(true);
    try {
      const res  = await fetch(`${API_BASE_URL}/staff`, { headers:{ Authorization:token } });
      if (res.ok) { const data = await res.json(); setStaff(Array.isArray(data) ? data : []); }
    } catch {} finally { setStaffLoading(false); }
  }, [token, canViewStaff]);

  useEffect(() => { fetchProfile(); fetchStaff(); }, [fetchProfile, fetchStaff]);

  const saveProfile = async () => {
    setSaving(true); setError(''); setSuccess('');
    try {
      const res  = await fetch(`${API_BASE_URL}/profile`, { method:'PUT', headers, body: JSON.stringify(editForm) });
      const data = await res.json();
      if (res.ok) { setProfile(data.user); setEditing(false); setSuccess('Profile updated ✅'); }
      else throw new Error(data.error || 'Failed');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const setEF = (k) => (v) => setEditForm((p) => ({...p, [k]:v}));

  const filteredStaff = staff.filter((s) =>
    [s.name, s.email, s.role].join(' ').toLowerCase().includes(search.toLowerCase())
  );

  // ── Profile card ────────────────────────────────────────────────────────────
  const ProfileCard = ({ user }) => (
    <Card>
      <View style={s.profileHeader}>
        <Avatar name={user.name} />
        <View style={{ flex:1 }}>
          <Text style={s.profileName}>{user.name}</Text>
          <View style={{ flexDirection:'row', gap:spacing[2], flexWrap:'wrap', marginTop:spacing[1] }}>
            <Badge variant={roleBadgeVariant(user.role)} label={user.role?.toUpperCase()} />
            <Badge variant="neutral" label={COMPANY_NAMES[user.company] || user.company || '—'} />
          </View>
        </View>
      </View>

      <View style={s.infoGrid}>
        <InfoRow icon="📧" label="Email"     value={user.email} />
        <InfoRow icon="📱" label="Phone"     value={user.phone} />
        <InfoRow icon="🎂" label="DOB"       value={formatDate(user.dob)} />
        <InfoRow icon="📅" label="Age"       value={String(user.age||'—')} />
        <InfoRow icon="🏢" label="Joined"    value={formatDate(user.joiningDate)} />
        <InfoRow icon="🆔" label="ID Proof"  value={user.idProofType ? `${user.idProofType.toUpperCase()}: ${user.idProofNumber||'—'}` : '—'} />
        <InfoRow icon="🏠" label="Address"   value={user.address} />
        <InfoRow icon="🚨" label="Emergency" value={user.emergencyContact} />
      </View>
    </Card>
  );

  return (
    <ScreenWrapper refreshing={loading} onRefresh={fetchProfile}>
      <View style={pageStyles.header}>
        <Text style={pageStyles.title}>👤 Profile</Text>
      </View>

      <TabBar tabs={TABS} active={activeTab} onChange={(k) => { setActiveTab(k); setSelectedStaff(null); }} />

      <AlertBanner type="danger"  message={error}   />
      <AlertBanner type="success" message={success} />

      {/* ── MY PROFILE ── */}
      {activeTab === 'myprofile' && (
        loading ? <Spinner /> : !profile ? (
          <AlertBanner type="danger" message="Failed to load profile." />
        ) : (
          <>
            <ProfileCard user={profile} />

            {!editing ? (
              <Btn
                label="✏️ Edit Profile"
                onPress={() => setEditing(true)}
                variant="primary"
                block
                size="lg"
                style={{ marginTop: spacing[4] }}
              />
            ) : (
              <Card style={{ marginTop: spacing[4] }}>
                <CardTitle>✏️ Edit Your Details</CardTitle>
                <Input label="Phone"            value={editForm.phone}            onChangeText={setEF('phone')}            placeholder="Phone number" />
                <Input label="DOB (YYYY-MM-DD)" value={editForm.dob}              onChangeText={setEF('dob')}              placeholder="e.g. 1995-06-15" />
                <Input label="Age"              value={String(editForm.age||'')}  onChangeText={setEF('age')}              keyboardType="numeric" placeholder="Age" />
                <Input label="Joining Date"     value={editForm.joiningDate}      onChangeText={setEF('joiningDate')}      placeholder="YYYY-MM-DD" />
                <Input label="Address"          value={editForm.address}          onChangeText={setEF('address')}          placeholder="Full address" />
                <Input label="Emergency Contact" value={editForm.emergencyContact} onChangeText={setEF('emergencyContact')} placeholder="Emergency phone" />
                <View style={{ flexDirection:'row', gap:spacing[3] }}>
                  <Btn label={saving ? '⏳ Saving…' : '✅ Save'} onPress={saveProfile} loading={saving} variant="success" style={{ flex:1 }} size="lg" />
                  <Btn label="Cancel" onPress={() => setEditing(false)} variant="secondary" style={{ flex:1 }} size="lg" />
                </View>
              </Card>
            )}
          </>
        )
      )}

      {/* ── STAFF DIRECTORY ── */}
      {activeTab === 'staff' && canViewStaff && (
        selectedStaff ? (
          <>
            <Btn
              label="← Back to Directory"
              onPress={() => setSelectedStaff(null)}
              variant="secondary"
              style={{ marginBottom: spacing[4] }}
            />
            <ProfileCard user={selectedStaff} />
          </>
        ) : (
          <>
            <Input placeholder="🔍 Search name, email, role…" value={search} onChangeText={setSearch} style={{ marginBottom: spacing[3] }} />

            {staffLoading ? <Spinner /> : filteredStaff.length === 0 ? (
              <EmptyState message="No staff found." />
            ) : (
              filteredStaff.map((st) => (
                <Card key={st._id} style={{ marginBottom: spacing[3] }}>
                  <View style={s.staffRow}>
                    <Avatar name={st.name} size={40} />
                    <View style={{ flex:1, marginLeft: spacing[3] }}>
                      <Text style={s.staffName}>{st.name}</Text>
                      <Text style={s.staffEmail}>{st.email}</Text>
                    </View>
                    <View style={{ alignItems:'flex-end', gap: spacing[2] }}>
                      <Badge variant={roleBadgeVariant(st.role)} label={st.role?.toUpperCase()} />
                      <Btn label="View" size="sm" variant="primary" onPress={() => setSelectedStaff(st)} />
                    </View>
                  </View>
                </Card>
              ))
            )}
          </>
        )
      )}
    </ScreenWrapper>
  );
}

const s = StyleSheet.create({
  profileHeader: { flexDirection:'row', gap:spacing[4], marginBottom:spacing[4], alignItems:'center' },
  profileName:   { fontSize:fontSize.xl, fontWeight:'800', color:colors.text },
  infoGrid:      { gap: spacing[1] },
  staffRow:      { flexDirection:'row', alignItems:'center' },
  staffName:     { fontWeight:'700', color:colors.text, fontSize:fontSize.base },
  staffEmail:    { fontSize:fontSize.sm, color:colors.textMuted },
});
