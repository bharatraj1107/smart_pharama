import React, { useEffect, useState, useCallback, useContext } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { AuthContext } from '../navigation/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import API_BASE_URL from '../config';
import ScreenWrapper from '../components/ScreenWrapper';
import {
  Card, CardHeader, CardTitle, Badge, AlertBanner,
  Btn, Input, Spinner, EmptyState, StatCard,
} from '../components/ui';
import { colors, spacing, fontSize, statusBadgeVariant, pageStyles } from '../styles/theme';

const STATUS_OPTIONS = [
  { value:'present',  label:'✅ Present'  },
  { value:'absent',   label:'❌ Absent'   },
  { value:'half-day', label:'⏰ Half Day' },
  { value:'od',       label:'📄 OD'       },
  { value:'wfh',      label:'🏠 WFH'     },
  { value:'late',     label:'🕐 Late'    },
];

function ChipRow({ options, value, onChange }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing[4] }}>
      <View style={{ flexDirection:'row', gap: spacing[2] }}>
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <View key={opt.value}
              style={[ch.chip, active && ch.active]}
              onStartShouldSetResponder={() => true}
              onResponderRelease={() => onChange(opt.value)}
            >
              <Text style={[ch.text, active && ch.activeText]}>{opt.label}</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}
const ch = StyleSheet.create({
  chip:       { paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius:999, borderWidth:1, borderColor:colors.border, backgroundColor:colors.surface },
  active:     { backgroundColor:colors.primary, borderColor:colors.primary },
  text:       { fontSize:fontSize.sm, color:colors.text },
  activeText: { color:'#fff', fontWeight:'700' },
});

export default function AttendanceScreen() {
  const { session }    = useContext(AuthContext);
  const { isRole }     = usePermissions();
  const token          = session?.token;
  const userName       = session?.name || 'Worker';
  const today          = new Date().toISOString().split('T')[0];

  const [records,       setRecords]       = useState([]);
  const [workers,       setWorkers]       = useState([]);
  const [todayEntry,    setTodayEntry]    = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error,         setError]         = useState('');

  // Mark form (manager/admin)
  const [markForm, setMarkForm] = useState({ workerName:'', status:'present', notes:'' });
  const [marking,  setMarking]  = useState(false);
  const setMF = (k) => (v) => setMarkForm((p) => ({...p, [k]:v}));

  const headers = { 'Content-Type':'application/json', Authorization: token };

  const fetchRecords = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res  = await fetch(`${API_BASE_URL}/attendance?date=${today}`, { headers:{ Authorization:token } });
      if (!res.ok) throw new Error('Unable to load attendance.');
      const data = await res.json();
      setRecords(Array.isArray(data) ? data : []);
      setTodayEntry((Array.isArray(data) ? data : []).find((r) => r.workerName === userName) || null);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [today, token, userName]);

  const fetchWorkers = useCallback(async () => {
    if (isRole('worker')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/workers`, { headers:{ Authorization:token } });
      if (res.ok) setWorkers(await res.json());
    } catch {}
  }, [token, isRole]);

  useEffect(() => { fetchRecords(); fetchWorkers(); }, [fetchRecords, fetchWorkers]);

  // Worker self-check-in / check-out
  const submitAttendance = async (status) => {
    setActionLoading(true); setError('');
    try {
      const now  = new Date();
      const time = now.toLocaleTimeString('en-GB', { hour12:false });
      const body = {
        workerName: userName, date: today, status,
        checkIn:  status === 'present'  ? time : undefined,
        checkOut: status === 'checkout' ? time : undefined,
      };
      const res = await fetch(`${API_BASE_URL}/attendance`, {
        method:'POST', headers, body: JSON.stringify(body),
      });
      if (!res.ok) { const e = await res.json().catch(()=>{}); throw new Error(e?.error||'Update failed.'); }
      await fetchRecords();
    } catch (err) { setError(err.message); }
    finally { setActionLoading(false); }
  };

  // Manager mark attendance
  const markAttendance = async () => {
    if (!markForm.workerName) { setError('Select a worker.'); return; }
    setMarking(true); setError('');
    try {
      const body = { workerName: markForm.workerName, date:today, status:markForm.status, notes:markForm.notes };
      const res  = await fetch(`${API_BASE_URL}/attendance`, {
        method:'POST', headers, body: JSON.stringify(body),
      });
      const data = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(data.error||'Failed');
      setMarkForm({ workerName:'', status:'present', notes:'' });
      fetchRecords();
    } catch (err) { setError(err.message); }
    finally { setMarking(false); }
  };

  const summary = records.reduce(
    (acc, r) => {
      if (r.status === 'present') acc.present++;
      else if (r.status === 'absent') acc.absent++;
      else if (r.status === 'leave') acc.leave++;
      return acc;
    },
    { present:0, absent:0, leave:0 },
  );

  return (
    <ScreenWrapper refreshing={loading} onRefresh={() => { fetchRecords(); fetchWorkers(); }}>
      <View style={pageStyles.header}>
        <Text style={pageStyles.title}>⏱️ Attendance</Text>
        <Text style={pageStyles.subtitle}>
          {isRole('worker')
            ? 'Mark your attendance and view history.'
            : 'View and manage team attendance.'}
        </Text>
      </View>

      <AlertBanner type="danger" message={error} />

      {/* Today status + worker actions */}
      <Card style={{ marginBottom: spacing[4] }}>
        <CardTitle>Today — {today}</CardTitle>
        <Text style={s.muted}>Status: <Text style={s.bold}>{todayEntry ? todayEntry.status : 'Not marked'}</Text></Text>
        {todayEntry && (
          <Text style={s.muted}>
            Check-in: {todayEntry.checkIn || '—'} · Check-out: {todayEntry.checkOut || '—'}
          </Text>
        )}
        {isRole('worker') && (
          <View style={[s.row, { marginTop: spacing[3], gap: spacing[2] }]}>
            <Btn
              label={actionLoading ? '…' : (todayEntry?.status==='present' ? 'Update Check-In' : 'Check In')}
              onPress={() => submitAttendance('present')}
              variant="success" size="sm" disabled={actionLoading}
            />
            <Btn
              label={actionLoading ? '…' : 'Check Out'}
              onPress={() => submitAttendance('checkout')}
              variant="secondary" size="sm"
              disabled={actionLoading || !todayEntry}
            />
          </View>
        )}
      </Card>

      {/* Summary */}
      <View style={[s.row, { gap: spacing[3], marginBottom: spacing[4] }]}>
        <StatCard value={summary.present} label="Present" color={colors.success} style={{ flex:1 }} />
        <StatCard value={summary.absent}  label="Absent"  color={colors.danger}  style={{ flex:1 }} />
        <StatCard value={summary.leave}   label="Leave"   color={colors.primary} style={{ flex:1 }} />
      </View>

      {/* Manager mark form */}
      {!isRole('worker') && (
        <Card style={{ marginBottom: spacing[4] }}>
          <CardTitle>✏️ Mark Attendance</CardTitle>

          <Text style={s.label}>Worker *</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing[3] }}>
            <View style={{ flexDirection:'row', gap: spacing[2] }}>
              {workers.map((w) => (
                <View key={w._id}
                  style={[ch.chip, markForm.workerName===w.name && ch.active]}
                  onStartShouldSetResponder={()=>true}
                  onResponderRelease={() => setMF('workerName')(w.name)}
                >
                  <Text style={[ch.text, markForm.workerName===w.name && ch.activeText]}>
                    {w.name} ({w.role})
                  </Text>
                </View>
              ))}
            </View>
          </ScrollView>

          <Text style={s.label}>Status *</Text>
          <ChipRow options={STATUS_OPTIONS} value={markForm.status} onChange={setMF('status')} />

          <Input label="Notes" value={markForm.notes} onChangeText={setMF('notes')} placeholder="Remarks…" />

          <Btn
            label={marking ? '⏳ Marking…' : '✅ Mark Attendance (Check-In)'}
            onPress={markAttendance} loading={marking} variant="success" block size="lg"
          />
        </Card>
      )}

      {/* Records table */}
      <Card>
        <CardHeader>
          <CardTitle style={{ marginBottom:0 }}>
            {isRole('worker') ? 'Your History' : 'Attendance Records'}
          </CardTitle>
          <Btn label="Refresh" onPress={fetchRecords} variant="primary" size="sm" />
        </CardHeader>

        {loading ? <Spinner /> : records.length === 0 ? (
          <EmptyState message="No attendance records found." />
        ) : (
          records.map((rec) => (
            <View key={`${rec.workerName}-${rec.date}`} style={s.recRow}>
              <View style={{ flex:1 }}>
                <Text style={s.recName}>{rec.workerName}</Text>
                <Text style={s.muted}>{rec.date} · In: {rec.checkIn||'—'} · Out: {rec.checkOut||'—'}</Text>
              </View>
              <Badge variant={statusBadgeVariant(rec.status)} label={rec.status} />
            </View>
          ))
        )}
      </Card>
    </ScreenWrapper>
  );
}

const s = StyleSheet.create({
  muted:   { fontSize:fontSize.sm, color:colors.textMuted, marginTop:2 },
  bold:    { fontWeight:'700', color:colors.text },
  label:   { fontSize:fontSize.sm, fontWeight:'600', color:colors.text, marginBottom: spacing[1] },
  row:     { flexDirection:'row', alignItems:'center' },
  recRow:  { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingVertical: spacing[3], borderBottomWidth:1, borderBottomColor:colors.border },
  recName: { fontWeight:'700', color:colors.text, fontSize:fontSize.base },
});
