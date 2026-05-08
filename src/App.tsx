import { useEffect, useState, useRef } from 'react';
import { 
  MessageSquare, User, Settings, Phone, Video, Paperclip, 
  Search, Send, CheckCircle2, CircleDashed, X
} from 'lucide-react';

interface WAContact {
  profile: { name: string };
  wa_id: string;
}

interface WAMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
}

interface Conversation {
  id: string;
  name: string;
  phone: string;
  messages: WAMessage[];
  lastMessageTime: string;
  unreadCount?: number;
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>([
    {
      id: "16315551234",
      name: "Budi Santoso",
      phone: "+62 812 3456 7890",
      messages: [
        {
          from: "16315551234",
          id: "msg1",
          timestamp: (Date.now() / 1000 - 300).toString(),
          type: "text",
          text: { body: "Halo, apakah pesanan saya sudah dikirim? Terima kasih" }
        },
        {
          from: "me",
          id: "msg2",
          timestamp: (Date.now() / 1000 - 120).toString(),
          type: "text",
          text: { body: "Halo Pak Budi, pesanan #8829 sedang diproses oleh tim gudang kami dan akan dikirim sore ini." }
        },
        {
          from: "16315551234",
          id: "msg3",
          timestamp: (Date.now() / 1000 - 60).toString(),
          type: "text",
          text: { body: "Baik, bisa minta nomor resinya nanti kalau sudah ada?" }
        }
      ],
      lastMessageTime: new Date(Date.now() - 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    },
    {
      id: "62899999999",
      name: "Siti Aminah",
      phone: "+62 899 9999 999",
      messages: [
        {
          from: "62899999999",
          id: "msg_siti1",
          timestamp: (Date.now() / 1000 - 86400).toString(),
          type: "text",
          text: { body: "Terima kasih atas bantuannya, layanannya sangat memuaskan!" }
        }
      ],
      lastMessageTime: "Kemarin"
    }
  ]);
  
  const [activeChatId, setActiveChatId] = useState<string>("16315551234");
  const activeChatIdRef = useRef<string>("16315551234");
  const [inputText, setInputText] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [config, setConfig] = useState({
    phoneNumberId: localStorage.getItem('wa_phone_number_id') || '',
    accessToken: localStorage.getItem('wa_access_token') || '',
  });

  const activeChat = conversations.find(c => c.id === activeChatId) || conversations[0];

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    // Track processed message IDs to avoid duplicates during polling
    const processedMsgIds = new Set<string>();

    const fetchWebhooks = async () => {
      try {
        const res = await fetch('/api/webhooks');
        if (!res.ok) return;
        const webhooks: any[] = await res.json();
        
        webhooks.forEach((payload: any) => {
          if (payload.error) {
            console.error(payload.message);
            // Optionally we could show a toast here, but console is good enough for now
            return;
          }
          if (
            payload.entry &&
            payload.entry[0].changes &&
            payload.entry[0].changes[0] &&
            payload.entry[0].changes[0].value.messages
          ) {
            const value = payload.entry[0].changes[0].value;
            const contacts = value.contacts as WAContact[];
            const messages = value.messages as WAMessage[];
            
            if (!messages || messages.length === 0) return;
            
            const newMsg = messages[0];
            
            // Skip if already processed
            if (processedMsgIds.has(newMsg.id)) return;
            processedMsgIds.add(newMsg.id);

            const contact = contacts ? contacts[0] : null;
            const phone = newMsg.from;
            const defaultName = contact ? contact.profile.name : `+${phone}`;

            setConversations(prev => {
              // Avoid duplicates in state
              const existingChat = prev.find(c => c.id === phone);
              if (existingChat && existingChat.messages.some(m => m.id === newMsg.id)) {
                return prev;
              }

              const isCurrentlyActive = phone === activeChatIdRef.current;

              if (existingChat) {
                const updatedChat = {
                  ...existingChat,
                  messages: [...existingChat.messages, newMsg],
                  lastMessageTime: new Date(parseInt(newMsg.timestamp) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  unreadCount: isCurrentlyActive ? 0 : (existingChat.unreadCount || 0) + 1
                };
                return [updatedChat, ...prev.filter(c => c.id !== phone)];
              } else {
                const newChat: Conversation = {
                  id: phone,
                  name: defaultName,
                  phone: `+${phone}`,
                  messages: [newMsg],
                  lastMessageTime: new Date(parseInt(newMsg.timestamp) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  unreadCount: isCurrentlyActive ? 0 : 1
                };
                return [newChat, ...prev];
              }
            });
          }
        });
      } catch (err) {
        console.error('Error fetching webhooks:', err);
      }
    };

    // Initial fetch
    fetchWebhooks();

    // Poll every 3 seconds
    const interval = setInterval(fetchWebhooks, 3000);
    return () => clearInterval(interval);
  }, []);

  const formatTimestamp = (ts: string) => {
    const date = new Date(parseInt(ts) * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;

    if (!config.phoneNumberId || !config.accessToken) {
      alert('Mohon isi Phone Number ID dan Access Token di Pengaturan (Settings) terlebih dahulu.');
      setIsSettingsOpen(true);
      return;
    }
    
    // Optimistic UI update
    const newMsg: WAMessage = {
      from: "me",
      id: `local_${Date.now()}`,
      timestamp: Math.floor(Date.now() / 1000).toString(),
      type: "text",
      text: { body: inputText }
    };

    setConversations(prev => {
      return prev.map(chat => {
        if (chat.id === activeChatId) {
          return {
            ...chat,
            messages: [...chat.messages, newMsg],
            lastMessageTime: formatTimestamp(newMsg.timestamp)
          };
        }
        return chat;
      });
    });

    const messageToSend = inputText;
    setInputText("");
    
    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: activeChat.id,
          message: messageToSend,
          token: config.accessToken,
          phoneId: config.phoneNumberId
        })
      });
      const data: any = await res.json();
      if (!res.ok) {
        console.error("Failed to send", data);
        alert(`Gagal mengirim pesan: ${data.error?.message || JSON.stringify(data)}`);
      }
    } catch (err) {
      console.error(err);
      alert('Gagal mengirim pesan, periksa koneksi Anda.');
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50 font-sans">
      {/* Global Sidebar */}
      <aside className="w-16 bg-slate-900 flex flex-col items-center py-6 space-y-8 text-slate-400">
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-xl">
          B
        </div>
        <div className="flex flex-col space-y-6">
          <div className="p-2 bg-slate-800 text-white rounded-lg cursor-pointer">
            <MessageSquare className="w-6 h-6" />
          </div>
          <div className="p-2 hover:text-white cursor-pointer transition-colors">
            <User className="w-6 h-6" />
          </div>
          <div onClick={() => setIsSettingsOpen(true)} className="p-2 hover:text-white cursor-pointer transition-colors">
            <Settings className="w-6 h-6" />
          </div>
        </div>
        <div className="mt-auto pb-4">
          <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs text-white cursor-pointer">
            A
          </div>
        </div>
      </aside>

      {/* Conversations List */}
      <nav className="w-80 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-100">
          <h1 className="text-xl font-bold text-slate-800">Inbox</h1>
          <p className="text-xs text-slate-500 uppercase tracking-widest mt-1">Business API Dashboard</p>
          <div className="mt-4 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-slate-400" />
            </div>
            <input 
              type="text" 
              placeholder="Cari pesan..." 
              className="w-full bg-slate-100 border-none rounded-lg py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none" 
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.map(chat => {
            const lastMsg = chat.messages[chat.messages.length - 1];
            const isActive = chat.id === activeChatId;
            return (
              <div 
                key={chat.id}
                onClick={() => {
                  setActiveChatId(chat.id);
                  if (chat.unreadCount) {
                    setConversations(prev => prev.map(c => 
                      c.id === chat.id ? { ...c, unreadCount: 0 } : c
                    ));
                  }
                }}
                className={`p-4 border-l-4 cursor-pointer transition-colors ${
                  isActive 
                    ? 'bg-indigo-50 border-indigo-600' 
                    : 'hover:bg-slate-50 border-transparent'
                }`}
              >
                <div className="flex justify-between items-start">
                  <span className={`font-semibold truncate pr-2 ${chat.unreadCount ? 'text-slate-900 font-bold' : 'text-slate-900'}`}>{chat.name}</span>
                  <span className={`text-xs whitespace-nowrap ${isActive ? 'text-indigo-600 font-medium' : chat.unreadCount ? 'text-indigo-600 font-bold' : 'text-slate-400'}`}>
                    {chat.lastMessageTime}
                  </span>
                </div>
                <div className="flex justify-between items-center mt-1">
                  <p className={`text-sm truncate flex-1 pr-2 ${chat.unreadCount ? 'text-slate-800 font-medium' : 'text-slate-600'}`}>
                    {lastMsg?.type === 'text' ? lastMsg.text?.body : `[${lastMsg?.type}]`}
                  </p>
                  {!!chat.unreadCount && chat.unreadCount > 0 && (
                    <span className="shrink-0 flex items-center justify-center w-5 h-5 bg-indigo-600 text-white rounded-full text-[10px] font-bold">
                      {chat.unreadCount}
                    </span>
                  )}
                </div>
                {isActive && chat.id === "16315551234" && (
                  <div className="mt-2 flex space-x-2">
                    <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded uppercase">New Order</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </nav>

      {/* Chat View */}
      <main className="flex-1 flex flex-col bg-[#F8FAFC]">
        {activeChat ? (
          <>
            <header className="h-16 bg-white border-b border-slate-200 flex items-center px-6 justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-500 font-medium">
                  {activeChat.name.charAt(0)}
                </div>
                <div>
                  <h2 className="font-bold text-slate-900">{activeChat.name}</h2>
                  <p className="text-xs text-green-600 flex items-center font-medium">
                    <span className="w-2 h-2 bg-green-500 rounded-full mr-1.5" /> Online
                  </p>
                </div>
              </div>
              <div className="flex space-x-2">
                <button className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors">
                  <Phone className="w-5 h-5" />
                </button>
                <button className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors">
                  <Video className="w-5 h-5" />
                </button>
              </div>
            </header>

            <section className="flex-1 p-6 space-y-4 overflow-y-auto flex flex-col">
              <div className="flex justify-center mb-2">
                <span className="px-3 py-1 bg-slate-200 text-slate-500 text-[10px] font-bold rounded-full uppercase tracking-tighter">
                  Hari Ini
                </span>
              </div>
              
              {activeChat.messages.map((msg) => {
                const isMe = msg.from === "me";
                return (
                  <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-lg ${isMe ? 'self-end' : 'self-start'}`}>
                    <div className={`p-3 rounded-2xl shadow-sm ${
                      isMe 
                        ? 'bg-indigo-600 text-white rounded-tr-none' 
                        : 'bg-white text-slate-800 rounded-tl-none border border-slate-200'
                    }`}>
                      <p className="text-sm">
                        {msg.type === 'text' ? msg.text?.body : `[Unsupported message type: ${msg.type}]`}
                      </p>
                      <span className={`text-[10px] block mt-1 text-right ${isMe ? 'text-indigo-200' : 'text-slate-400'}`}>
                        {formatTimestamp(msg.timestamp)} {isMe && '• Dilihat'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </section>

            <footer className="p-4 bg-white border-t border-slate-200">
              <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded-xl px-2 py-1">
                <button className="p-2 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-slate-100 transition-colors">
                  <Paperclip className="w-5 h-5" />
                </button>
                <input 
                  type="text" 
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Ketik balasan Anda..." 
                  className="flex-1 bg-transparent border-none focus:ring-0 text-sm py-2 px-2 focus:outline-none" 
                />
                <button 
                  onClick={handleSendMessage}
                  disabled={!inputText.trim()}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-indigo-700 transition-colors disabled:opacity-50 flex flex-row items-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  Kirim
                </button>
              </div>
            </footer>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <p>Pilih percakapan untuk mulai membaca pesan.</p>
          </div>
        )}
      </main>

      {/* Customer Details Panel */}
      {activeChat && (
        <aside className="w-64 bg-white border-l border-slate-200 p-6 flex flex-col overflow-y-auto">
          <div className="text-center">
            <div className="w-20 h-20 bg-slate-100 rounded-full mx-auto mb-4 border-2 border-slate-200 flex items-center justify-center text-slate-400 text-2xl font-bold">
              {activeChat.name.charAt(0)}
            </div>
            <h3 className="font-bold text-slate-900">{activeChat.name}</h3>
            <p className="text-xs text-slate-500 mt-1">Jakarta, Indonesia</p>
          </div>

          <div className="mt-8 space-y-6">
            <div>
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Kontak Details</h4>
              <div className="space-y-2">
                <div className="text-sm text-slate-700 font-medium flex justify-between">
                  <span>WA:</span> 
                  <span className="text-slate-500">{activeChat.phone}</span>
                </div>
                <div className="text-sm text-slate-700 font-medium flex justify-between">
                  <span>ID:</span> 
                  <span className="text-slate-500">CUST-{activeChat.phone.slice(-4)}</span>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Riwayat Pesanan</h4>
              <div className="space-y-3">
                <div className="p-2 bg-slate-50 rounded border border-slate-100">
                  <p className="text-xs font-bold text-slate-800">Order #8829</p>
                  <p className="text-[10px] text-slate-500">Pending • Rp 450.000</p>
                </div>
                <div className="p-2 bg-slate-50 rounded border border-slate-100">
                  <p className="text-xs font-bold text-slate-800">Order #8712</p>
                  <p className="text-[10px] text-slate-500">Selesai • Rp 1.200.000</p>
                </div>
              </div>
            </div>

            <div className="mt-auto pt-4">
              <button className="w-full border border-slate-200 text-slate-600 py-2 rounded-lg text-xs font-bold hover:bg-slate-50 transition-colors">
                Lihat Profil Lengkap
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-800">Pengaturan WhatsApp API</h2>
              <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto max-h-[70vh]">
              
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                <h3 className="text-sm font-bold text-slate-800 mb-2">Konfigurasi Webhook</h3>
                <p className="text-xs text-slate-500 mb-4">Gunakan konfigurasi ini di Meta App Dashboard (WhatsApp &gt; Configuration).</p>
                
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">Callback URL</label>
                    <div className="flex">
                      <input 
                        type="text" 
                        readOnly 
                        value={`${window.location.origin}/api/webhook`} 
                        className="w-full bg-white border border-slate-300 rounded-l-lg py-1.5 px-3 text-sm focus:outline-none"
                      />
                      <button 
                        onClick={() => navigator.clipboard.writeText(`${window.location.origin}/api/webhook`)}
                        className="bg-slate-200 text-slate-700 px-3 py-1.5 rounded-r-lg text-xs font-bold hover:bg-slate-300 border border-l-0 border-slate-300"
                      >Copy</button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">Verify Token</label>
                    <div className="flex">
                      <input 
                        type="text" 
                        readOnly 
                        value="my-verify-token" 
                        className="w-full bg-white border border-slate-300 rounded-l-lg py-1.5 px-3 text-sm focus:outline-none"
                      />
                      <button 
                        onClick={() => navigator.clipboard.writeText("my-verify-token")}
                        className="bg-slate-200 text-slate-700 px-3 py-1.5 rounded-r-lg text-xs font-bold hover:bg-slate-300 border border-l-0 border-slate-300"
                      >Copy</button>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold text-slate-800 mb-2">Kredensial API</h3>
                <p className="text-xs text-slate-500 mb-4">Diperlukan untuk membalas/mengirim pesan.</p>
                
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">Phone Number ID</label>
                    <input 
                      type="text" 
                      value={config.phoneNumberId}
                      onChange={e => setConfig({...config, phoneNumberId: e.target.value})}
                      placeholder="Misal: 1059345267..." 
                      className="w-full bg-white border border-slate-300 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">Access Token / Permanent Token</label>
                    <input 
                      type="password" 
                      value={config.accessToken}
                      onChange={e => setConfig({...config, accessToken: e.target.value})}
                      placeholder="EAAL..." 
                      className="w-full bg-white border border-slate-300 rounded-lg py-2 px-3 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end space-x-2">
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 text-sm font-bold text-slate-600 hover:text-slate-800"
              >
                Batal
              </button>
              <button 
                onClick={() => {
                  localStorage.setItem('wa_phone_number_id', config.phoneNumberId);
                  localStorage.setItem('wa_access_token', config.accessToken);
                  setIsSettingsOpen(false);
                }}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-indigo-700"
              >
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
