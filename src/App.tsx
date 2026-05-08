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
  status?: 'sent' | 'delivered' | 'read' | 'failed' | string;
  text?: { body: string };
  image?: { id: string; caption?: string; mime_type?: string };
  video?: { id: string; caption?: string; mime_type?: string };
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
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const saved = localStorage.getItem('wa_conversations');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to parse conversations from local storage', e);
    }
    return [
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
            status: "read",
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
    ];
  });
  
  useEffect(() => {
    localStorage.setItem('wa_conversations', JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
      Notification.requestPermission();
    }
  }, []);
  
  const [activeChatId, setActiveChatId] = useState<string>("16315551234");
  const activeChatIdRef = useRef<string>("16315551234");
  const [inputText, setInputText] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [config, setConfig] = useState({
    phoneNumberId: localStorage.getItem('wa_phone_number_id') || '',
    accessToken: localStorage.getItem('wa_access_token') || '',
  });
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeChat = conversations.find(c => c.id === activeChatId) || conversations[0];

  const scrollToBottom = (instant = false) => {
    messagesEndRef.current?.scrollIntoView({ behavior: instant ? "auto" : "smooth" });
  };

  const prevChatIdRef = useRef(activeChatId);

  useEffect(() => {
    if (prevChatIdRef.current !== activeChatId) {
      scrollToBottom(true);
      prevChatIdRef.current = activeChatId;
    } else {
      scrollToBottom(false);
    }
  }, [activeChat?.messages.length, activeChatId]);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
    
    // Clear unread count when switching chats
    setConversations(prev => prev.map(c => c.id === activeChatId ? { ...c, unreadCount: 0 } : c));
  }, [activeChatId]);

  // Mark all unread incoming messages as read
  const conversationsRef = useRef(conversations);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  
  useEffect(() => {
    if (!activeChat) return;
    
    const unreadMessages = activeChat.messages.filter(m => m.from !== 'me' && m.status !== 'read_by_me');
    if (unreadMessages.length > 0 && config.phoneNumberId && config.accessToken) {
      unreadMessages.forEach(async (msg) => {
        try {
          await fetch('/api/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messageId: msg.id,
              phoneId: config.phoneNumberId,
              token: config.accessToken
            })
          });
          
          setConversations(prev => prev.map(chat => {
            if (chat.id === activeChat.id) {
              return {
                ...chat,
                messages: chat.messages.map(m => m.id === msg.id ? { ...m, status: 'read_by_me' } : m)
              };
            }
            return chat;
          }));
        } catch (e) {
          console.error("Failed to mark as read", e);
        }
      });
    }
  }, [activeChat, config.phoneNumberId, config.accessToken]);

  const isInitialFetchRef = useRef(true);

  useEffect(() => {
    // Track processed message IDs to avoid duplicates during polling
    const processedMsgIds = new Set<string>();

    const fetchWebhooks = async () => {
      try {
        const res = await fetch(`/api/webhooks?t=${Date.now()}`, {
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
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
            payload.entry[0].changes[0]
          ) {
            const value = payload.entry[0].changes[0].value;
            
            // Handle message status updates
            if (value.statuses) {
              const statusUpdates = value.statuses;
              statusUpdates.forEach((statusUpdate: any) => {
                const foundChat = conversationsRef.current.find(c => c.messages.some(m => m.id === statusUpdate.id));
                if (!foundChat) return; // Wait until local message gets real ID

                if (processedMsgIds.has(`${statusUpdate.id}_${statusUpdate.status}`)) return;
                processedMsgIds.add(`${statusUpdate.id}_${statusUpdate.status}`);
                
                setConversations(prev => {
                  return prev.map(chat => {
                    const hasMessage = chat.messages.some(m => m.id === statusUpdate.id);
                    if (hasMessage) {
                      return {
                        ...chat,
                        messages: chat.messages.map(m => {
                          if (m.id === statusUpdate.id) {
                            const weights: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: -1 };
                            const currentW = weights[m.status || 'pending'] ?? 0;
                            const newW = weights[statusUpdate.status] ?? 0;
                            if (newW > currentW) {
                              return { ...m, status: statusUpdate.status };
                            }
                          }
                          return m;
                        })
                      };
                    }
                    return chat;
                  });
                });
              });
            }

            // Handle new messages
            if (value.messages) {
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

              if (!isInitialFetchRef.current && Notification.permission === "granted") {
                const isCurrentlyActive = phone === activeChatIdRef.current;
                if (!isCurrentlyActive || document.hidden) {
                  const body = newMsg.type === 'text' ? newMsg.text?.body : newMsg.type === 'image' ? (newMsg.image?.caption || '[Gambar]') : newMsg.type === 'video' ? (newMsg.video?.caption || '[Video]') : `[${newMsg.type}]`;
                  const notification = new Notification(`Pesan baru dari ${defaultName}`, {
                    body: body,
                  });
                  notification.onclick = () => {
                    window.focus();
                  };
                }
              }

              setConversations(prev => {
                // Avoid duplicates in state
                const existingChat = prev.find(c => c.id === phone);
                if (existingChat && existingChat.messages.some(m => m.id === newMsg.id)) {
                  return prev;
                }

                const isCurrentlyActive = phone === activeChatIdRef.current;
                const isInitial = isInitialFetchRef.current;

                if (existingChat) {
                  const updatedChat = {
                    ...existingChat,
                    messages: [...existingChat.messages, newMsg],
                    lastMessageTime: new Date(parseInt(newMsg.timestamp) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    unreadCount: isCurrentlyActive ? 0 : isInitial ? (existingChat.unreadCount || 0) : (existingChat.unreadCount || 0) + 1
                  };
                  return [updatedChat, ...prev.filter(c => c.id !== phone)];
                } else {
                  const newChat: Conversation = {
                    id: phone,
                    name: defaultName,
                    phone: `+${phone}`,
                    messages: [newMsg],
                    lastMessageTime: new Date(parseInt(newMsg.timestamp) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    unreadCount: isCurrentlyActive || isInitial ? 0 : 1
                  };
                  return [newChat, ...prev];
                }
              });
            }
          }
        });
        isInitialFetchRef.current = false;
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
      status: "pending",
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
      } else {
        if (data.messages && data.messages.length > 0) {
          const realId = data.messages[0].id;
          
          setConversations(prev => {
            return prev.map(chat => {
              if (chat.id === activeChatId) {
                return {
                  ...chat,
                  messages: chat.messages.map(m => m.id === newMsg.id ? { ...m, id: realId, status: 'sent' } : m)
                };
              }
              return chat;
            });
          });
        }
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
                    {lastMsg?.type === 'text' ? lastMsg.text?.body : lastMsg?.type === 'image' ? (lastMsg.image?.caption || '[Gambar]') : lastMsg?.type === 'video' ? (lastMsg.video?.caption || '[Video]') : lastMsg?.type === 'unsupported' ? '' : `[${lastMsg?.type}]`}
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
                if (msg.type === 'unsupported') return null;
                const isMe = msg.from === "me";
                return (
                  <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[85%] md:max-w-lg ${isMe ? 'self-end' : 'self-start'}`}>
                    <div className={`p-3 rounded-2xl shadow-sm overflow-hidden ${
                      isMe 
                        ? 'bg-indigo-600 text-white rounded-tr-none' 
                        : 'bg-white text-slate-800 rounded-tl-none border border-slate-200'
                    }`}>
                      {msg.type === 'text' && <p className="text-sm whitespace-pre-wrap break-words [word-break:break-word]">{msg.text?.body}</p>}
                      {msg.type === 'image' && (
                        <div className="flex flex-col">
                          <img 
                            src={`/api/media?id=${msg.image?.id}&token=${config.accessToken}`} 
                            alt={msg.image?.caption || "Gambar"} 
                            className="max-w-[240px] sm:max-w-xs rounded-xl max-h-64 object-cover cursor-pointer hover:opacity-90 transition-opacity" 
                            loading="lazy" 
                            onClick={() => setFullscreenImage(`/api/media?id=${msg.image?.id}&token=${config.accessToken}`)}
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                            }}
                          />
                          <div className="hidden text-sm italic opacity-80 p-2 bg-slate-100 rounded-lg text-slate-500 mt-2">Gagal memuat gambar.</div>
                          {msg.image?.caption && <p className="text-sm mt-2">{msg.image.caption}</p>}
                        </div>
                      )}
                      {msg.type === 'video' && (
                        <div className="flex flex-col">
                          <video 
                            src={`/api/media?id=${msg.video?.id}&token=${config.accessToken}`} 
                            controls
                            className="max-w-[240px] sm:max-w-xs rounded-xl max-h-64 bg-black object-contain" 
                            onError={(e) => {
                              (e.target as HTMLVideoElement).style.display = 'none';
                              (e.target as HTMLVideoElement).nextElementSibling?.classList.remove('hidden');
                            }}
                          />
                          <div className="hidden text-sm italic opacity-80 p-2 bg-slate-100 rounded-lg text-slate-500 mt-2">Gagal memuat video.</div>
                          {msg.video?.caption && <p className="text-sm mt-2">{msg.video.caption}</p>}
                        </div>
                      )}
                      {msg.type !== 'text' && msg.type !== 'image' && msg.type !== 'video' && msg.type !== 'unsupported' && (
                        <p className="text-sm italic opacity-80">[Pesan tipe {msg.type} belum didukung]</p>
                      )}
                      <span className={`text-[10px] block mt-1 text-right whitespace-nowrap ${isMe ? 'text-indigo-200' : 'text-slate-400'}`}>
                        {formatTimestamp(msg.timestamp)} {isMe && (msg.status === 'read' ? '• Dilihat' : msg.status === 'delivered' ? '• Terkirim' : msg.status === 'sent' ? '• Dikirim' : msg.status === 'failed' ? '• Gagal' : msg.status === 'pending' ? '• Mengirim...' : '')}
                      </span>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </section>

            <footer className="p-4 bg-white border-t border-slate-200">
              <div className="flex items-end space-x-2 bg-slate-50 border border-slate-200 rounded-xl px-2 py-1 relative">
                <button className="p-2 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-slate-100 transition-colors mb-0.5">
                  <Paperclip className="w-5 h-5" />
                </button>
                <textarea 
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Ketik balasan Anda..." 
                  className="flex-1 bg-transparent border-none focus:ring-0 text-sm py-2.5 px-2 focus:outline-none resize-none" 
                  rows={Math.min(Math.max(inputText.split('\n').length, 1), 5)}
                />
                <button 
                  onClick={handleSendMessage}
                  disabled={!inputText.trim()}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-indigo-700 transition-colors disabled:opacity-50 flex flex-row items-center gap-2 mb-0.5"
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

      {/* Fullscreen Image Modal */}
      {fullscreenImage && (
        <div 
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-[100] p-4 cursor-zoom-out"
          onClick={() => setFullscreenImage(null)}
        >
          <img 
            src={fullscreenImage} 
            alt="Fullscreen" 
            className="max-w-full max-h-screen object-contain"
          />
          <button 
            className="absolute top-4 right-4 text-white bg-black/50 p-2 rounded-full hover:bg-black/70 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setFullscreenImage(null);
            }}
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      )}
    </div>
  );
}
