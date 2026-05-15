import { useState, useRef, useEffect } from 'react';
import Papa from 'papaparse';
import { Upload, FileText, Send, CheckCircle2, AlertCircle, X, Megaphone, Loader2 } from 'lucide-react';

interface Template {
  name: string;
  language: string;
  components: any[];
  id: string;
  status: string;
}

export default function BroadcastView({ config }: { config: { phoneNumberId: string, accessToken: string, wabaId?: string } }) {
  const [file, setFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<any[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState('');
  
  const [variableMapping, setVariableMapping] = useState<Record<string, string>>({}); // Maps template expected var to CSV header
  const [phoneColumn, setPhoneColumn] = useState<string>('');
  
  const [broadcastStatus, setBroadcastStatus] = useState<'idle' | 'sending' | 'completed'>('idle');
  const [results, setResults] = useState<{ success: number, failed: number, total: number }>({ success: 0, failed: 0, total: 0 });
  const [broadcastLogs, setBroadcastLogs] = useState<{ phone: string, status: string, error?: string }[]>([]);

  const fetchTemplates = async () => {
    if (!config.wabaId || !config.accessToken) {
      setTemplateError("WABA ID atau Access Token belum diatur di Settings.");
      return;
    }
    setTemplateLoading(true);
    setTemplateError('');
    try {
      const res = await fetch(`https://graph.facebook.com/v19.0/${config.wabaId}/message_templates?limit=100`, {
        headers: {
          'Authorization': `Bearer ${config.accessToken}`
        }
      });
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error.message || "Gagal mengambil template");
      }
      // filter only approved templates
      const activeTemplates = (data.data || []).filter((t: any) => t.status === 'APPROVED');
      setTemplates(activeTemplates);
    } catch (err: any) {
      setTemplateError(err.message || 'Terjadi kesalahan saat mengambil template.');
    } finally {
      setTemplateLoading(false);
    }
  };

  useEffect(() => {
    if (config.wabaId) {
      fetchTemplates();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.wabaId]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    
    Papa.parse(f, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const fields = results.meta.fields || [];
        setHeaders(fields);
        setCsvData(results.data);
        
        // Auto-detect phone column heuristic
        const detectedPhone = fields.find(h => h.toLowerCase().includes('phone') || h.toLowerCase().includes('telp') || h.toLowerCase().includes('nomor') || h.toLowerCase().includes('whatsapp') || h.toLowerCase().includes('wa'));
        if (detectedPhone) {
          setPhoneColumn(detectedPhone);
        } else if (fields.length > 0) {
          setPhoneColumn(fields[0]); // default to first
        }
      },
      error: (error) => {
        alert("Gagal membaca file CSV: " + error.message);
      }
    });
  };

  const getExpectedVariables = (template: Template) => {
    const vars: { componentType: string, subType?: string, buttonIndex?: number, varIndex: number, textMatch: string }[] = [];
    
    template.components.forEach(comp => {
      if (comp.type === 'HEADER' && comp.format === 'TEXT' && comp.text) {
        const matches = comp.text.match(/\{\{(\d+)\}\}/g);
        if (matches) {
          matches.forEach(m => {
            const num = parseInt(m.replace(/\D/g, ''));
            vars.push({ componentType: 'header', varIndex: num, textMatch: m });
          });
        }
      }
      
      if (comp.type === 'BODY' && comp.text) {
        const matches = comp.text.match(/\{\{(\d+)\}\}/g);
        if (matches) {
          matches.forEach(m => {
            const num = parseInt(m.replace(/\D/g, ''));
            vars.push({ componentType: 'body', varIndex: num, textMatch: m });
          });
        }
      }
      
      if (comp.type === 'BUTTONS' && comp.buttons) {
        comp.buttons.forEach((btn: any, idx: number) => {
          if (btn.type === 'URL' && btn.url && btn.url.includes('{{1}}')) {
            vars.push({ componentType: 'button', subType: 'url', buttonIndex: idx, varIndex: 1, textMatch: 'Button URL {{1}}' });
          }
        });
      }
    });
    
    return vars;
  };

  const expectedVars = selectedTemplate ? getExpectedVariables(selectedTemplate) : [];

  const sendBroadcast = async () => {
    if (!selectedTemplate) return;
    setBroadcastStatus('sending');
    setBroadcastLogs([]);
    let successCount = 0;
    let failedCount = 0;
    let currentLogs: { phone: string, status: string, error?: string }[] = [];
    
    // We use the selected phone column
    if (!phoneColumn) {
      alert("Silakan pilih kolom Nomor WhatsApp.");
      setBroadcastStatus('idle');
      return;
    }
    
    for (const row of csvData) {
      let phoneNumber = row[phoneColumn];
      if (!phoneNumber) {
        failedCount++;
        continue;
      }
      
      // format phone number if needed (strip + or leading 0)
      phoneNumber = phoneNumber.replace(/\D/g, '');
      if (phoneNumber.startsWith('0')) phoneNumber = '62' + phoneNumber.substring(1);
      
      // aggregate parameters per component
      const componentGroups: Record<string, any> = {};

      expectedVars.forEach(v => {
        const expectedKey = `${v.componentType}-${v.buttonIndex !== undefined ? v.buttonIndex : ''}-${v.varIndex}`;
        const mappedHeader = variableMapping[expectedKey];
        const val = mappedHeader && row[mappedHeader] ? row[mappedHeader] : '-'; // default dash if empty

        // setup group
        const groupKey = v.componentType === 'button' ? `button_${v.buttonIndex}` : v.componentType;
        if (!componentGroups[groupKey]) {
          if (v.componentType === 'button') {
            componentGroups[groupKey] = {
              type: "button",
              sub_type: v.subType,
              index: String(v.buttonIndex),
              parameters: []
            };
          } else {
            componentGroups[groupKey] = {
              type: v.componentType,
              parameters: []
            };
          }
        }

        componentGroups[groupKey].parameters.push({
          type: "text",
          text: String(val)
        });
      });

      const bodyComponent = Object.values(componentGroups);

      try {
        const payload: any = {
          to: phoneNumber,
          type: "template",
          token: config.accessToken,
          phoneId: config.phoneNumberId,
          template: {
            name: selectedTemplate.name,
            language: {
              code: selectedTemplate.language
            }
          }
        };

        if (bodyComponent) {
          payload.template.components = bodyComponent;
        }

        console.log("Sending payload:", JSON.stringify(payload));

        const res = await fetch(`/api/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.error) {
          console.error("Broadcast failed for", phoneNumber, JSON.stringify(data.error));
          failedCount++;
          let detailedError = data.error.message || JSON.stringify(data.error);
          if (data.error.error_data && data.error.error_data.details) {
            detailedError += " - " + data.error.error_data.details;
          }
          currentLogs.push({ phone: phoneNumber, status: 'error', error: detailedError });
        } else {
          successCount++;
          currentLogs.push({ phone: phoneNumber, status: 'success' });
        }
      } catch (err: any) {
         failedCount++;
         currentLogs.push({ phone: phoneNumber, status: 'error', error: err.message || 'Unknown error' });
      }
      
      // update state gradually
      setResults({ success: successCount, failed: failedCount, total: csvData.length });
      setBroadcastLogs([...currentLogs]);
      
      // wait a bit to avoid rate limits
      await new Promise(r => setTimeout(r, 100));
    }
    
    setBroadcastStatus('completed');
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-y-auto">
      <div className="p-8 max-w-4xl mx-auto w-full space-y-8">
        
        <div>
          <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
            <Megaphone className="w-8 h-8 text-indigo-600" />
            Broadcast Message
          </h1>
          <p className="text-slate-500 mt-2">Kirim pesan WhatsApp menggunakan Template Meta langsung dari file CSV.</p>
        </div>

        {/* Step 1: Upload File */}
        <div className="bg-white p-6 border border-slate-200 rounded-xl shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-bold">1</span>
            Upload File CSV
          </h2>
          <p className="text-sm text-slate-600">Pastikan baris pertama (header) berisi nama variabel yang akan digunakan.</p>
          
          <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 flex flex-col items-center justify-center text-center">
            <input 
              type="file" 
              accept=".csv" 
              className="hidden" 
              id="csv-upload" 
              onChange={handleFileUpload}
            />
            <label htmlFor="csv-upload" className="cursor-pointer flex flex-col items-center">
              <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center mb-4">
                <Upload className="w-6 h-6 text-indigo-600" />
              </div>
              <span className="text-sm font-bold text-indigo-600 hover:text-indigo-700">Pilih file CSV</span>
              <span className="text-xs text-slate-500 mt-1">{file ? file.name : "or drag and drop"}</span>
            </label>
          </div>
          
          {csvData.length > 0 && (
            <div className="bg-green-50 text-green-700 p-3 rounded-lg text-sm flex items-center gap-2 font-medium">
              <CheckCircle2 className="w-5 h-5" />
              Berhasil membaca {csvData.length} baris data dengan kolom: {headers.join(', ')}
            </div>
          )}
        </div>

        {/* Step 2: Pilih Template */}
        {csvData.length > 0 && (
          <div className="bg-white p-6 border border-slate-200 rounded-xl shadow-sm space-y-4">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-bold">2</span>
              Pilih Template Pesan
            </h2>
            
            {!config.wabaId ? (
              <div className="bg-amber-50 text-amber-700 p-4 rounded-lg flex items-start gap-3">
                <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-bold">WhatsApp Business Account ID (WABA ID) belum diatur.</p>
                  <p className="mt-1">Silakan buka Pengaturan API WhatsApp dan masukkan WABA ID untuk memuat template pesan. WABA ID bisa ditemukan di Meta App Dashboard.</p>
                </div>
              </div>
            ) : templateLoading ? (
              <div className="flex justify-center p-8 text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>
            ) : templateError ? (
              <div className="bg-red-50 text-red-600 p-4 rounded-lg text-sm">{templateError}</div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {templates.map(t => (
                    <div 
                      key={t.id} 
                      onClick={() => {
                        setSelectedTemplate(t);
                        setVariableMapping({});
                      }}
                      className={`cursor-pointer p-4 rounded-xl border-2 transition-colors ${selectedTemplate?.id === t.id ? 'border-indigo-600 bg-indigo-50/50' : 'border-slate-200 hover:border-indigo-300'}`}
                    >
                      <h3 className="font-bold text-slate-800">{t.name}</h3>
                      <p className="text-xs text-slate-500 uppercase tracking-wider">{t.language}</p>
                      
                      <div className="mt-3 text-sm text-slate-600 line-clamp-3 bg-white p-2 rounded border border-slate-100">
                        {t.components.find(c => c.type === 'BODY')?.text || '(Tidak ada body)'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Mapping Variables */}
        {selectedTemplate && (
          <div className="bg-white p-6 border border-slate-200 rounded-xl shadow-sm space-y-4">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-bold">3</span>
              Atur Variabel Template
            </h2>
            
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 whitespace-pre-wrap font-mono">
               {selectedTemplate.components.find(c => c.type === 'BODY')?.text}
            </div>

            <div className="space-y-4 mt-6">
              <h3 className="font-bold text-slate-800 text-sm">Target Tujuan</h3>
              <div className="flex items-center gap-4">
                <div className="px-3 py-1.5 bg-slate-100 rounded font-bold text-slate-700 w-32 text-center text-xs">Nomor WA</div>
                <span className="text-slate-400">=</span>
                <select 
                  value={phoneColumn} 
                  onChange={(e) => setPhoneColumn(e.target.value)}
                  className="flex-1 bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium text-slate-700"
                >
                  <option value="">Pilih kolom...</option>
                  {headers.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
            </div>

            {expectedVars.length > 0 ? (
              <div className="space-y-4 mt-6">
                <hr className="border-slate-100" />
                <h3 className="font-bold text-slate-800 text-sm">Variabel Dinamis</h3>
                <p className="text-sm font-medium text-slate-500 mb-2">Petakan variabel di template dengan kolom di CSV Anda:</p>
                {expectedVars.map(v => {
                  const expectedKey = `${v.componentType}-${v.buttonIndex !== undefined ? v.buttonIndex : ''}-${v.varIndex}`;
                  return (
                    <div key={expectedKey} className="flex items-center gap-4">
                      <div className="px-3 py-1.5 bg-slate-100 rounded font-bold text-slate-700 w-32 text-center text-xs truncate" title={`${v.componentType.toUpperCase()} ${v.textMatch}`}>
                        {v.componentType.toUpperCase()} {v.textMatch}
                      </div>
                      <span className="text-slate-400">=</span>
                      <select 
                        value={variableMapping[expectedKey] || ''} 
                        onChange={(e) => setVariableMapping(prev => ({...prev, [expectedKey]: e.target.value}))}
                        className="flex-1 bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">Pilih kolom...</option>
                        {headers.map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-500 italic mt-4">Template ini tidak memiliki variabel.</p>
            )}
          </div>
        )}

        {/* Step 4: Confirm and Send */}
        {selectedTemplate && (
          <div className="bg-white p-6 border border-slate-200 rounded-xl shadow-sm space-y-4">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-bold">4</span>
              Kirim Broadcast
            </h2>
            
            {broadcastStatus === 'idle' ? (
              <div>
                <p className="text-sm text-slate-600 mb-6">Anda akan mengirimkan pesan broadcast ke <strong>{csvData.length}</strong> kontak menggunakan template <strong>{selectedTemplate.name}</strong>.</p>
                <button 
                  onClick={sendBroadcast}
                  className="w-full bg-indigo-600 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors"
                >
                  <Send className="w-5 h-5" />
                  Kirim Broadcast Sekarang
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-between items-center bg-slate-50 p-4 rounded-lg">
                  <div>
                    <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">Progress</p>
                    <p className="text-2xl font-bold text-slate-800 mt-1">
                      {results.success + results.failed} <span className="text-base text-slate-500 font-normal">/ {results.total}</span>
                    </p>
                  </div>
                  <div className="flex gap-4">
                    <div className="text-center">
                      <p className="text-sm font-bold text-green-600">Berhasil</p>
                      <p className="text-xl font-bold bg-green-50 text-green-700 px-3 py-1 rounded w-full mt-1">{results.success}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-red-600">Gagal</p>
                      <p className="text-xl font-bold bg-red-50 text-red-700 px-3 py-1 rounded w-full mt-1">{results.failed}</p>
                    </div>
                  </div>
                </div>
                
                {broadcastStatus === 'sending' ? (
                  <div className="flex items-center justify-center gap-2 text-indigo-600 font-bold py-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Sedang Mengirim...
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2 text-green-600 font-bold py-2 bg-green-50 rounded-lg">
                    <CheckCircle2 className="w-5 h-5" />
                    Pengiriman Selesai
                  </div>
                )}

                {broadcastLogs.length > 0 && (
                  <div className="mt-4 border border-slate-200 rounded-lg overflow-hidden">
                    <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 font-bold text-slate-700 text-sm">
                      Logs Pengiriman
                    </div>
                    <div className="max-h-64 overflow-y-auto p-4 space-y-2 bg-white">
                      {broadcastLogs.map((log, idx) => (
                        <div key={idx} className={`p-2 rounded text-sm font-medium border ${log.status === 'success' ? 'bg-green-50 text-green-700 border-green-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
                          <div className="flex justify-between items-start">
                            <span>{log.phone}</span>
                            <span className="uppercase text-[10px] tracking-wider px-2 py-0.5 rounded-full bg-white bg-opacity-50">
                              {log.status}
                            </span>
                          </div>
                          {log.error && (
                            <div className="mt-1 text-xs text-red-500 font-normal opacity-90 font-mono break-words">
                              {log.error}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        
      </div>
    </div>
  );
}
