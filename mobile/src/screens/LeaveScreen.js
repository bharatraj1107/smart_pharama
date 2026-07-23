import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { usePermissions } from '../hooks/usePermissions';
import { AuthContext } from '../navigation/AuthContext';
import { useContext } from 'react';
import ScreenWrapper from '../components/ScreenWrapper';
import {
  Card, CardHeader, CardTitle, Badge, Btn, Input, EmptyState,
} from '../components/ui';
import { colors, spacing, fontSize, pageStyles } from '../styles/theme';

const LEAVE_TYPES = ['Sick', 'Casual', 'Paid', 'Unpaid'];

const SEED_REQUESTS = [
  { id:1, worker:'Alice', type:'Sick',   from:'2026-07-20', to:'2026-07-22', status:'Pending',  remarks:'Waiting for review' },
  { id:2, worker:'Bob',   type:'Casual', from:'2026-07-25', to:'2026-07-25', status:'Approved', remarks:'Take care' },
];

function statusVariant(s) {
  return s === 'Approved' ? 'success' : s === 'Rejected' ? 'danger' : 'warning';
}

export default function LeaveScreen() {
  const { session }   = useContext(AuthContext);
  const { role, can } = usePermissions();
  const myName        = session?.name || 'You';

  const [requests, setRequests] = useState(SEED_REQUESTS);
  const [form, setForm] = useState({ type:'Sick', from:'', to:'', reason:'' });
  const [submitted, setSubmitted] = useState(false);
  const set = (k) => (v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = () => {
    if (!form.from || !form.to) { return; }
    setRequests((prev) => [
      ...prev,
      { id: prev.length + 1, worker: myName, type: form.type, from: form.from, to: form.to, status: 'Pending', remarks: 'Submitted' },
    ]);
    setSubmitted(true);
    setForm({ type:'Sick', from:'', to:'', reason:'' });
  };

  const updateStatus = (id, status) => {
    setRequests((prev) =>
      prev.map((r) => r.id === id
        ? { ...r, status, remarks: status === 'Approved' ? 'Approved by supervisor' : 'Rejected by supervisor' }
        : r)
    );
  };

  return (
    <ScreenWrapper>
      <View style={pageStyles.header}>
        <Text style={pageStyles.title}>🗓️ Leave Management</Text>
        <Text style={pageStyles.subtitle}>
          {role === 'worker'
            ? 'Apply for leave and view your history.'
            : 'View and manage leave requests.'}
        </Text>
      </View>

      {/* Apply form — workers only */}
      {role === 'worker' && (
        <Card style={{ marginBottom: spacing[4] }}>
          <CardTitle>Apply for Leave</CardTitle>

          <Text style={s.label}>Leave Type</Text>
          <View style={s.typeRow}>
            {LEAVE_TYPES.map((t) => (
              <View key={t}
                style={[s.chip, form.type === t && s.chipActive]}
                onStartShouldSetResponder={()=>true}
                onResponderRelease={() => set('type')(t)}
              >
                <Text style={[s.chipText, form.type === t && s.chipActiveText]}>{t}</Text>
              </View>
            ))}
          </View>

          <Input label="From (YYYY-MM-DD)" value={form.from} onChangeText={set('from')} placeholder="e.g. 2026-08-01" />
          <Input label="To (YYYY-MM-DD)"   value={form.to}   onChangeText={set('to')}   placeholder="e.g. 2026-08-03" />
          <Input label="Reason" value={form.reason} onChangeText={set('reason')} placeholder="Brief reason…" multiline />

          <Btn label="Submit Leave Request" onPress={handleSubmit} variant="primary" block size="lg" />
          {submitted && (
            <Text style={{ color:colors.success, marginTop:spacing[2], fontSize:fontSize.sm }}>
              ✅ Leave request submitted.
            </Text>
          )}
        </Card>
      )}

      {/* Requests list */}
      <Card>
        <CardHeader>
          <CardTitle style={{ marginBottom:0 }}>Leave Requests</CardTitle>
          <Badge variant="primary" label={`${requests.length} total`} />
        </CardHeader>

        {requests.length === 0 ? (
          <EmptyState message="No leave requests." />
        ) : (
          requests.map((req) => (
            <View key={req.id} style={s.reqRow}>
              <View style={{ flex:1 }}>
                <Text style={s.reqWorker}>{req.worker} — {req.type}</Text>
                <Text style={s.reqDates}>{req.from} → {req.to}</Text>
                <Text style={s.reqRemarks}>{req.remarks}</Text>
              </View>
              <View style={{ alignItems:'flex-end', gap:spacing[2] }}>
                <Badge variant={statusVariant(req.status)} label={req.status} />
                {can('approveLeave') && req.status === 'Pending' && (
                  <View style={{ flexDirection:'row', gap:spacing[2] }}>
                    <Btn label="✓" size="sm" variant="success" onPress={() => updateStatus(req.id, 'Approved')} />
                    <Btn label="✗" size="sm" variant="danger"  onPress={() => updateStatus(req.id, 'Rejected')} />
                  </View>
                )}
              </View>
            </View>
          ))
        )}
      </Card>
    </ScreenWrapper>
  );
}

const s = StyleSheet.create({
  label:         { fontSize:fontSize.sm, fontWeight:'600', color:colors.text, marginBottom:spacing[1] },
  typeRow:       { flexDirection:'row', flexWrap:'wrap', gap:spacing[2], marginBottom:spacing[4] },
  chip:          { paddingHorizontal:spacing[3], paddingVertical:spacing[2], borderRadius:999, borderWidth:1, borderColor:colors.border, backgroundColor:colors.surface },
  chipActive:    { backgroundColor:colors.primary, borderColor:colors.primary },
  chipText:      { fontSize:fontSize.sm, color:colors.text },
  chipActiveText:{ color:'#fff', fontWeight:'700' },
  reqRow:        { flexDirection:'row', paddingVertical:spacing[3], borderBottomWidth:1, borderBottomColor:colors.border, gap:spacing[3] },
  reqWorker:     { fontWeight:'700', color:colors.text, fontSize:fontSize.base },
  reqDates:      { fontSize:fontSize.sm, color:colors.textMuted },
  reqRemarks:    { fontSize:fontSize.xs, color:colors.textMuted, marginTop:2 },
});
