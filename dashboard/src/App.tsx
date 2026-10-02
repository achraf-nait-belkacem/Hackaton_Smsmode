import { useState, useEffect } from 'react'

type Slot = { id: string; label: string; isoStart: string; booked: boolean; bookedBy: string | null }

function App() {
  const [slots, setSlots] = useState<Slot[]>([])
  const [availableSlots, setAvailableSlots] = useState<Slot[]>([])
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [replies, setReplies] = useState<{ global: {command: string, reply: string}[], sessions: Record<string, {command: string, reply: string}[]> }>({ global: [], sessions: {} })
  const [newCommand, setNewCommand] = useState('')
  const [newReply, setNewReply] = useState('')
  const [replyMessage, setReplyMessage] = useState('')
  const [historyPhone, setHistoryPhone] = useState('')
  const [history, setHistory] = useState<{direction: string, text: string, timestamp: number, senderName: string}[]>([])

  useEffect(() => {
    let active = true
    const refreshSlots = async () => {
      const [slotsResponse, availableResponse] = await Promise.all([
        fetch('/api/slots'),
        fetch('/api/slots/available'),
      ])
      if (!slotsResponse.ok || !availableResponse.ok) {
        throw new Error('Erreur lors du rafraîchissement des créneaux')
      }
      const [allSlots, available] = await Promise.all([
        slotsResponse.json(),
        availableResponse.json(),
      ])
      if (active) {
        setSlots(allSlots)
        setAvailableSlots(available)
      }
    }

    const refresh = () => refreshSlots().catch(err => console.error(err))
    refresh()
    const interval = window.setInterval(refresh, 15000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    fetch('/api/replies')
      .then(res => res.json())
      .then(data => setReplies(data))
      .catch(err => console.error('Erreur replies:', err))
  }, [])

  const bookedSlots = slots.filter(s => s.booked)

  const sendRCS = async () => {
    if (!phone) return;
    setMessage('');
    try {
      const res = await fetch('/send-rcs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, type: 'doctor' }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage('Message RCS envoyé ✓');
      } else {
        setMessage(`Erreur: ${data.error}`);
      }
    } catch {
      setMessage('Erreur: impossible de contacter le serveur');
    }
  }

  const addGlobalReply = async () => {
    if (!newCommand || !newReply) return;
    await fetch('/api/replies/global', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: newCommand, reply: newReply })
    });
    setNewCommand('');
    setNewReply('');
    setReplyMessage('Réponse ajoutée ✓');
    const data = await fetch('/api/replies').then(r => r.json());
    setReplies(data);
  };

  const deleteGlobalReply = async (command: string) => {
    await fetch(`/api/replies/global/${command}`, { method: 'DELETE' });
    const data = await fetch('/api/replies').then(r => r.json());
    setReplies(data);
  };

  const loadHistory = async () => {
    if (!historyPhone) return;
    const data = await fetch(`/api/sessions/${historyPhone}/history`).then(r => r.json());
    setHistory(data);
  };

  return (
    <div style={{ maxWidth: '680px', margin: '0 auto', padding: '1rem' }}>
      {/* premiere section */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div>
            <p style={{ fontSize: '18px', fontWeight: '500', margin: 0 }}>Rappels RCS</p>
            <p style={{ fontSize: '13px', color: 'gray', margin: 0 }}>Cabinet Médical </p>
          </div>
        </div>
      </div>

      {/* deuxieme section */}
      <div style={{ background: 'white', border: '0.5px solid #e5e5e5', borderRadius: '12px', padding: '1.25rem', marginBottom: '1rem' }}>

        <p style={{ fontSize: '15px', fontWeight: '500', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          Inviter un patient à réserver
        </p>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px' }}>
          <input
            type="text"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="336XXXXXXXX"
            style={{ flex: 1, height: '40px', padding: '0 12px', border: '0.5px solid #e5e5e5', borderRadius: '8px', fontSize: '14px' }}
          />
          <button
            onClick={sendRCS}
            style={{ background: '#185FA5', color: 'white', border: 'none', borderRadius: '8px', padding: '0 20px', height: '40px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' }}
          >
            Envoyer une proposition RCS
          </button>
          {message && <p style={{ color: 'green', marginTop: '8px', fontSize: '13px' }}> {message}</p>}
        </div>

      </div>

      {/* troisieme section */}
      <div style={{ background: 'white', border: '0.5px solid #e5e5e5', borderRadius: '12px', padding: '1.25rem', marginBottom: '1rem' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <p style={{ fontSize: '15px', fontWeight: '500', margin: 0 }}>
             Créneaux disponibles <span style={{ background: '#f0f0f0', color: 'gray', fontSize: '12px', padding: '2px 8px', borderRadius: '20px' }}>{availableSlots.length}</span>
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          {availableSlots.length === 0 && <p>Aucun créneau futur configuré.</p>}
            {availableSlots.map(slot => (
              <div key={slot.id} style={{ border: '0.5px solid #e5e5e5', borderRadius: '8px', padding: '12px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: '14px', fontWeight: '500', margin: 0 }}>{slot.label}</p>
                </div>
                <span style={{ background: '#EAF3DE', color: '#3B6D11', fontSize: '12px', padding: '3px 10px', borderRadius: '20px' }}>Libre</span>
              </div>
            ))}
        </div>
      </div>

      {/* quatrieme section */}
      <div style={{ background: 'white', border: '0.5px solid #e5e5e5', borderRadius: '12px', padding: '1.25rem', marginBottom: '1rem' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <p style={{ fontSize: '15px', fontWeight: '500', margin: 0 }}>
            Créneaux réservés <span style={{ background: '#f0f0f0', color: 'gray', fontSize: '12px', padding: '2px 8px', borderRadius: '20px' }}>{bookedSlots.length}</span>
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {bookedSlots.map(slot => (
            <div key={slot.id} style={{ border: '0.5px solid #e5e5e5', borderRadius: '8px', padding: '12px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '14px', fontWeight: '500', margin: 0 }}>{slot.label}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: '13px', fontWeight: '500', margin: 0 }}>{slot.bookedBy}</p>
              </div>
            </div>
          ))}
        </div>

      </div>

      {/* custom replies */}
      <div style={{ background: 'white', border: '0.5px solid #e5e5e5', borderRadius: '12px', padding: '1.25rem', marginBottom: '1rem' }}>
        <p style={{ fontSize: '15px', fontWeight: '500', marginBottom: '14px', margin: '0 0 14px 0' }}>Réponses automatiques globales</p>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
          <input
            type="text"
            value={newCommand}
            onChange={e => setNewCommand(e.target.value)}
            placeholder="Commande (ex: INFO)"
            style={{ flex: 1, height: '36px', padding: '0 10px', border: '0.5px solid #e5e5e5', borderRadius: '8px', fontSize: '13px' }}
          />
          <input
            type="text"
            value={newReply}
            onChange={e => setNewReply(e.target.value)}
            placeholder="Réponse"
            style={{ flex: 2, height: '36px', padding: '0 10px', border: '0.5px solid #e5e5e5', borderRadius: '8px', fontSize: '13px' }}
          />
          <button
            onClick={addGlobalReply}
            style={{ background: '#185FA5', color: 'white', border: 'none', borderRadius: '8px', padding: '0 16px', height: '36px', fontSize: '13px', cursor: 'pointer' }}
          >
            Ajouter
          </button>
        </div>

        {replyMessage && <p style={{ color: 'green', fontSize: '12px', marginBottom: '8px' }}>{replyMessage}</p>}

        {replies.global.length === 0 && (
          <p style={{ fontSize: '13px', color: 'gray' }}>Aucune réponse globale configurée.</p>
        )}

        {replies.global.map(r => (
          <div key={r.command} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', padding: '8px 10px', background: '#f9f9f9', borderRadius: '8px' }}>
            <span style={{ fontWeight: '600', fontSize: '13px', minWidth: '80px' }}>{r.command.toUpperCase()}</span>
            <span style={{ flex: 1, fontSize: '13px', color: '#444' }}>{r.reply}</span>
            <button
              onClick={() => deleteGlobalReply(r.command)}
              style={{ background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: '16px', lineHeight: '1' }}
            >×</button>
          </div>
        ))}
      </div>

      {/* chat history */}
      <div style={{ background: 'white', border: '0.5px solid #e5e5e5', borderRadius: '12px', padding: '1.25rem', marginBottom: '1rem' }}>
        <p style={{ fontSize: '15px', fontWeight: '500', margin: '0 0 14px 0' }}>Historique de conversation</p>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <input
            type="text"
            value={historyPhone}
            onChange={e => setHistoryPhone(e.target.value)}
            placeholder="336XXXXXXXX"
            style={{ flex: 1, height: '36px', padding: '0 10px', border: '0.5px solid #e5e5e5', borderRadius: '8px', fontSize: '13px' }}
          />
          <button
            onClick={loadHistory}
            style={{ background: '#185FA5', color: 'white', border: 'none', borderRadius: '8px', padding: '0 16px', height: '36px', fontSize: '13px', cursor: 'pointer' }}
          >
            Charger
          </button>
        </div>

        {history.length === 0 && historyPhone && (
          <p style={{ fontSize: '13px', color: 'gray' }}>Aucun historique pour ce numéro.</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {history.map((entry, i) => (
            <div key={i} style={{
              display: 'flex',
              flexDirection: entry.direction === 'out' ? 'row-reverse' : 'row',
              gap: '8px',
              alignItems: 'flex-end'
            }}>
              <div style={{
                maxWidth: '70%',
                background: entry.direction === 'out' ? '#185FA5' : '#f0f0f0',
                color: entry.direction === 'out' ? 'white' : '#222',
                borderRadius: '12px',
                padding: '8px 12px',
                fontSize: '13px'
              }}>
                <p style={{ margin: 0, fontWeight: '500', fontSize: '11px', opacity: 0.7, marginBottom: '2px' }}>{entry.senderName}</p>
                <p style={{ margin: 0 }}>{entry.text}</p>
                <p style={{ margin: 0, fontSize: '11px', opacity: 0.6, marginTop: '2px' }}>
                  {new Date(entry.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

export default App
