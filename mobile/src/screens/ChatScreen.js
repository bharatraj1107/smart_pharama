import React, { useEffect, useState, useCallback, useContext, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthContext } from '../navigation/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import API_BASE_URL from '../config';
import { AlertBanner, Spinner } from '../components/ui';
import { colors, spacing, fontSize } from '../styles/theme';

function getConversationId(a, b) {
  return [String(a||''), String(b||'')].sort().join('-');
}

export default function ChatScreen() {
  const { session } = useContext(AuthContext);
  const { isRole, role } = usePermissions();
  const token    = session?.token;
  const myUserId = session?.userId || '';
  const myName   = session?.name || (isRole('worker') ? 'Worker' : 'Admin');

  // Workers have supervisorId; admins/managers have workerId stored in session/storage
  const otherUserId = isRole('worker')
    ? (session?.supervisorId || '')
    : (session?.workerId || '');

  const conversationId = (myUserId && otherUserId)
    ? getConversationId(myUserId, otherUserId)
    : null;

  const [messages, setMessages] = useState([]);
  const [draft,    setDraft]    = useState('');
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const listRef = useRef(null);

  const loadMessages = useCallback(async () => {
    setError('');
    if (!token || !conversationId) { setMessages([]); setLoading(false); return; }
    try {
      setLoading(true);
      const res  = await fetch(`${API_BASE_URL}/api/messages/${conversationId}`, {
        headers: { Authorization: token },
      });
      if (!res.ok) { const t = await res.text().catch(()=>''); throw new Error(t || `Error ${res.status}`); }
      const data = await res.json();
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
    } catch (err) { setError(err.message || 'Failed to load chat'); setMessages([]); }
    finally { setLoading(false); }
  }, [token, conversationId]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  const sendMessage = async () => {
    if (!draft.trim()) return;
    if (!token || !myUserId || !otherUserId || !conversationId) {
      setError('Chat partner not set. Ask your admin to configure supervisorId / workerId in your profile.');
      return;
    }
    setError('');
    const optimistic = {
      _id: `tmp-${Date.now()}`, senderId: myUserId, receiverId: otherUserId,
      text: draft.trim(), timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    const sentDraft = draft.trim();
    setDraft('');

    try {
      const res = await fetch(`${API_BASE_URL}/api/messages`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiverId: otherUserId, text: sentDraft }),
      });
      if (!res.ok) { const t = await res.text().catch(()=>''); throw new Error(t || 'Send failed'); }
      await loadMessages();
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m._id !== optimistic._id));
      setError(err.message);
    }
  };

  const partnerLabel = isRole('worker') ? 'Supervisor' : 'Worker';

  const renderMessage = ({ item }) => {
    const isMine = String(item.senderId) === String(myUserId);
    return (
      <View style={[s.bubble, isMine ? s.bubbleMine : s.bubbleOther]}>
        <Text style={[s.bubbleMeta, isMine ? s.bubbleMetaMine : s.bubbleMetaOther]}>
          {isMine ? myName : partnerLabel}
          {'  '}
          {item.timestamp ? new Date(item.timestamp).toLocaleTimeString('en-GB', { hour12: false }) : ''}
        </Text>
        <Text style={[s.bubbleText, isMine ? s.bubbleTextMine : {}]}>{item.text}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex:1 }} behavior={Platform.OS==='ios' ? 'padding' : 'height'} keyboardVerticalOffset={90}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerTitle}>💬 {isRole('worker') ? `Chat with ${partnerLabel}` : 'Team Messages'}</Text>
          <Text style={s.headerSub}>Role: {role.toUpperCase()}</Text>
        </View>

        <AlertBanner type="danger" message={error} style={{ margin: spacing[3], marginBottom: 0 }} />

        {!conversationId && !loading && (
          <View style={s.noChat}>
            <Text style={s.noChatText}>
              Chat partner not configured.{'\n'}
              {isRole('worker')
                ? 'Ask your admin to set supervisorId in your account.'
                : 'Set workerId in your profile to chat with a worker.'}
            </Text>
          </View>
        )}

        {/* Messages */}
        {loading ? <Spinner /> : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item, i) => item._id || String(i)}
            renderItem={renderMessage}
            contentContainerStyle={s.listContent}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <View style={s.noChat}><Text style={s.noChatText}>No messages yet. Say hello!</Text></View>
            }
          />
        )}

        {/* Input */}
        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={`Message ${partnerLabel}…`}
            placeholderTextColor={colors.textLight}
            multiline
            onSubmitEditing={sendMessage}
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[s.sendBtn, (!draft.trim() || loading) && s.sendBtnDisabled]}
            onPress={sendMessage}
            disabled={!draft.trim() || loading}
          >
            <Text style={s.sendBtnText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:           { flex:1, backgroundColor:colors.background },
  header:         { backgroundColor:colors.surface, borderBottomWidth:1, borderBottomColor:colors.border, padding:spacing[4] },
  headerTitle:    { fontSize:fontSize.lg, fontWeight:'700', color:colors.text },
  headerSub:      { fontSize:fontSize.xs, color:colors.textMuted, marginTop:2 },
  listContent:    { padding:spacing[3], paddingBottom:spacing[4] },
  noChat:         { flex:1, alignItems:'center', justifyContent:'center', padding:spacing[8] },
  noChatText:     { color:colors.textMuted, textAlign:'center', fontSize:fontSize.base, lineHeight:22 },

  // Bubbles
  bubble:         { maxWidth:'80%', marginBottom:spacing[3], borderRadius:12, padding:spacing[3] },
  bubbleMine:     { alignSelf:'flex-end', backgroundColor:colors.primary },
  bubbleOther:    { alignSelf:'flex-start', backgroundColor:colors.surface, borderWidth:1, borderColor:colors.border },
  bubbleMeta:     { fontSize:fontSize.xs, marginBottom:4 },
  bubbleMetaMine: { color:'rgba(255,255,255,0.75)' },
  bubbleMetaOther:{ color:colors.textMuted },
  bubbleText:     { fontSize:fontSize.base, color:colors.text },
  bubbleTextMine: { color:'#fff' },

  // Input bar
  inputRow:       { flexDirection:'row', padding:spacing[3], backgroundColor:colors.surface, borderTopWidth:1, borderTopColor:colors.border, alignItems:'flex-end', gap:spacing[2] },
  input:          { flex:1, backgroundColor:colors.background, borderWidth:1, borderColor:colors.border, borderRadius:20, paddingHorizontal:spacing[4], paddingVertical:spacing[2], fontSize:fontSize.base, color:colors.text, maxHeight:100 },
  sendBtn:        { backgroundColor:colors.primary, borderRadius:20, paddingHorizontal:spacing[4], paddingVertical:spacing[3] },
  sendBtnDisabled:{ opacity:0.45 },
  sendBtnText:    { color:'#fff', fontWeight:'700', fontSize:fontSize.sm },
});
