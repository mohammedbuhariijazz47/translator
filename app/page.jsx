'use client'

import { useState, useEffect } from 'react'
import { useSession, signIn, signOut } from 'next-auth/react'
import { LANGUAGE_OPTIONS, getLanguageDisplayName } from '@/lib/languages'

function getInitials(from) {
  if (!from) return '??'
  const name = from.split('<')[0].trim()
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?'
}

function Avatar({ from, size = 36 }) {
  if (!from) return null
  const colors = ['bg-blue-100 text-blue-800','bg-green-100 text-green-800',
    'bg-yellow-100 text-yellow-800','bg-red-100 text-red-800','bg-purple-100 text-purple-800']
  const idx = from.charCodeAt(0) % colors.length || 0
  return (
    <div className={`rounded-full flex items-center justify-center font-medium text-sm flex-shrink-0 ${colors[idx]}`}
      style={{ width: size, height: size }}>
      {getInitials(from)}
    </div>
  )
}

function Spinner() {
  return (
    <span className="inline-block w-4 h-4 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin" />
  )
}

export default function Home() {
  const { data: session, status } = useSession()
  
  const [emails, setEmails] = useState([])
  const [loadingEmails, setLoadingEmails] = useState(false)
  const [emailsError, setEmailsError] = useState(null)
  
  // Folders and Compose State
  const [category, setCategory] = useState('inbox')
  const [composing, setComposing] = useState(false)
  const [composeTo, setComposeTo] = useState('')
  const [composeSubject, setComposeSubject] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [composeLang, setComposeLang] = useState('English')
  const [composeLoading, setComposeLoading] = useState(false)

  const [selected, setSelected] = useState(null)
  const [prefLang, setPrefLang] = useState('English')
  const [translations, setTranslations] = useState({})
  const [loadingId, setLoadingId] = useState(null)
  const [replyText, setReplyText] = useState('')
  const [replyLoading, setReplyLoading] = useState(false)
  const [sentReplies, setSentReplies] = useState({})
  const [draftingReply, setDraftingReply] = useState(false)
  const [checkingGrammar, setCheckingGrammar] = useState(false)
  const [checkingComposeGrammar, setCheckingComposeGrammar] = useState(false)

  useEffect(() => {
    async function fetchEmails() {
      if (status !== 'authenticated' || !session?.accessToken) return
      
      setLoadingEmails(true)
      setEmailsError(null)
      try {
        const res = await fetch(`/api/emails?max=20&category=${category}`, {
          headers: {
            'Authorization': `Bearer ${session.accessToken}`
          }
        })
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        setEmails(data.emails || [])
      } catch (err) {
        console.error('Fetch emails err:', err)
        setEmailsError(err.message)
      }
      setLoadingEmails(false)
    }
    fetchEmails()
  }, [status, session, category])

  useEffect(() => {
    if (session?.error === 'RefreshAccessTokenError') {
      setEmails([])
      setEmailsError('Your Google session expired. Please sign in again to load your Gmail messages.')
    }
  }, [session])

  async function handleTranslate(email) {
    if (translations[email.id]) return
    setLoadingId(email.id)
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: email.body, targetLang: prefLang }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setTranslations(t => ({ ...t, [email.id]: data }))
    } catch (e) {
      setTranslations(t => ({ ...t, [email.id]: { detectedLang: 'Unknown', translated: `Error: ${e.message}` } }))
    }
    setLoadingId(null)
  }

  async function handleSendReply(email) {
    if (!replyText.trim() || !session?.accessToken) return
    setReplyLoading(true)
    try {
      let detectedLang = translations[email.id]?.detectedLangCode || translations[email.id]?.detectedLang
      // If we haven't translated yet (or detection is missing), detect via /api/translate.
      // This avoids accidentally translating replies into English by default.
      if (!detectedLang || detectedLang === 'auto') {
        const detectRes = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: email.body, targetLang: prefLang }),
        })
        const detectData = await detectRes.json()
        if (detectData.error) throw new Error(detectData.error)
        setTranslations(t => ({ ...t, [email.id]: detectData }))
        detectedLang = detectData.detectedLangCode || detectData.detectedLang
      }
      detectedLang = detectedLang || 'en'
      const matchEmail = email.from.match(/<(.+)>/)
      const toEmail = matchEmail ? matchEmail[1] : email.from

      const res = await fetch('/api/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          replyText, 
          recipientLang: detectedLang,
          to: toEmail,
          subject: email.subject,
          threadId: email.threadId,
          accessToken: session.accessToken,
          sendAfterTranslate: true
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setSentReplies(s => ({ ...s, [email.id]: data.translated }))
      setReplyText('')
    } catch (e) {
      setSentReplies(s => ({ ...s, [email.id]: `Error: ${e.message}` }))
    }
    setReplyLoading(false)
  }

  async function handleSendCompose() {
    if (!composeTo.trim() || !composeBody.trim() || !session?.accessToken) return
    setComposeLoading(true)
    try {
      const res = await fetch('/api/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          replyText: composeBody, 
          recipientLang: composeLang, // Target recipient language
          to: composeTo,
          subject: composeSubject,
          accessToken: session.accessToken,
          sendAfterTranslate: true
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      
      setComposing(false)
      setComposeTo('')
      setComposeSubject('')
      setComposeBody('')
      alert('Email Translated and Sent successfully!')
      
      setCategory('sent')
    } catch (e) {
      alert(`Error: ${e.message}`)
    }
    setComposeLoading(false)
  }

  async function handleAutoDraft(email) {
    setDraftingReply(true)
    try {
      const res = await fetch('/api/ai/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailBody: email.body, lang: prefLang }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setReplyText(data.draft)
    } catch (e) {
      alert(`Auto-draft Error: ${e.message}`)
    }
    setDraftingReply(false)
  }

  async function handleGrammarCheck(text, setter, loadingSetter) {
    if (!text.trim()) return
    loadingSetter(true)
    try {
      const res = await fetch('/api/ai/grammar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setter(data.corrected)
    } catch (e) {
      alert(`Grammar check error: ${e.message}`)
    }
    loadingSetter(false)
  }

  if (status === 'loading') {
    return <div className="flex h-screen items-center justify-center bg-gray-50"><Spinner /></div>
  }

  if (status === 'unauthenticated') {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-50 p-4">
        <div className="text-4xl font-light text-gray-700 mb-6">
          <span className="text-blue-500">G</span>
          <span className="text-red-500">m</span>
          <span className="text-yellow-500">a</span>
          <span className="text-blue-500">i</span>
          <span className="text-green-500">l</span>
          <span className="text-gray-500 ml-2 text-3xl">· AI Translator</span>
        </div>
        <p className="text-gray-500 mb-8 max-w-md text-center leading-relaxed">
          Sign in securely with your Google account to automatically fetch emails and utilize Gemini AI for grammar and drafting.
        </p>
        <button 
          onClick={() => signIn('google')} 
          className="flex items-center gap-3 px-6 py-3 bg-white border border-gray-300 rounded-full shadow-sm hover:shadow-md hover:bg-gray-50 transition-all font-medium text-gray-700"
        >
          <img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-5 h-5" alt="Google" />
          Sign in with Google
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Top bar */}
      <header className="flex items-center gap-4 px-4 py-2 bg-white border-b border-gray-200 shadow-sm shrink-0">
        <div className="text-2xl font-light text-gray-700">
          <span className="text-blue-500">G</span>
          <span className="text-red-500">m</span>
          <span className="text-yellow-500">a</span>
          <span className="text-blue-500">i</span>
          <span className="text-green-500">l</span>
          <span className="text-gray-500 ml-2 text-lg hidden sm:inline">· AI Translator</span>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">{session?.user?.name}</span>
          </div>
          <div className="flex items-center gap-2 border-l border-gray-200 pl-4">
            <label className="text-sm text-gray-500 hidden sm:inline">Translate Received to:</label>
            <select
              value={prefLang}
              onChange={e => setPrefLang(e.target.value)}
              className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white focus:outline-none"
            >
              {LANGUAGE_OPTIONS.map(language => (
                <option key={language.code} value={language.name}>
                  {language.name} ({language.nativeName})
                </option>
              ))}
            </select>
          </div>
          <button 
            onClick={() => signIn('google', { prompt: 'select_account' })}
            className="text-sm text-gray-500 hover:text-gray-800 border border-gray-200 px-3 py-1 rounded-md"
          >
            Switch Account
          </button>
          <button 
            onClick={() => signOut()}
            className="text-sm text-gray-500 hover:text-gray-800 border border-gray-200 px-3 py-1 rounded-md"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 md:w-80 bg-white border-r border-gray-200 overflow-hidden flex flex-col flex-shrink-0">
          <div className="p-4 border-b border-gray-100 flex flex-col gap-3">
            <button 
              onClick={() => { setComposing(true); setSelected(null); }}
              className="w-full py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2"
            >
              Compose
            </button>
            <div className="flex flex-wrap gap-1 pb-1 text-xs mt-2 overflow-y-auto max-h-32">
              {['inbox', 'important', 'social', 'updates', 'draft', 'sent', 'outbox', 'snoozed', 'spam', 'bin'].map(c => (
                <button 
                  key={c}
                  onClick={() => { setCategory(c); setComposing(false); setSelected(null); }}
                  className={`px-3 py-1.5 rounded-md capitalize transition-colors ${category === c && !composing ? 'bg-blue-50 text-blue-700 font-semibold border border-blue-200' : 'text-gray-600 hover:bg-gray-100 border border-transparent'}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          
          <div className="p-3 border-b border-gray-100 flex items-center justify-between shadow-sm z-10 bg-white">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{category}</div>
            {loadingEmails && <Spinner />}
          </div>
          
          <div className="overflow-y-auto flex-1 pb-4">
            {emailsError && (
              <div className="p-4 text-xs text-red-500 bg-red-50 border-b border-red-100 space-y-3">
                <div>{emailsError}</div>
                {session?.error === 'RefreshAccessTokenError' && (
                  <button
                    onClick={() => signIn('google', { prompt: 'consent', access_type: 'offline' })}
                    className="inline-flex items-center rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    Reconnect Google
                  </button>
                )}
              </div>
            )}
            {emails.length === 0 && !loadingEmails && !emailsError && (
              <div className="p-6 text-sm text-gray-400 text-center">No emails found in {category}.</div>
            )}
            {emails.map(email => (
              <button
                key={email.id}
                onClick={() => { setSelected(email); setComposing(false); setReplyText('') }}
                className={`w-full text-left px-3 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${selected?.id === email.id && !composing ? 'bg-blue-50 border-l-4 border-l-blue-500' : 'border-l-4 border-l-transparent'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Avatar from={email.from} size={28} />
                  <span className="text-sm font-medium text-gray-800 truncate" title={email.from}>
                    {email.from.split('<')[0].trim() || 'Unknown'}
                  </span>
                </div>
                <div className="text-sm font-medium text-gray-700 truncate">{email.subject}</div>
                <div className="text-xs text-gray-400 truncate mt-0.5">{email.snippet}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-white relative">
          {!selected && !composing ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
              <div className="text-5xl">✉️</div>
              <div className="text-lg font-medium text-gray-500">Select an email to read or translate</div>
              <div className="text-sm">Click an email from the sidebar</div>
            </div>
          ) : composing ? (
            <div className="max-w-3xl mx-auto h-full flex flex-col">
              <h1 className="text-2xl font-light text-gray-800 mb-6 border-b border-gray-200 pb-4">New Message</h1>
              
              <div className="flex flex-col gap-4 flex-1">
                <div className="flex border-b border-gray-100 pb-2 items-center">
                  <span className="text-sm text-gray-500 w-20">To</span>
                  <input type="email" value={composeTo} onChange={e => setComposeTo(e.target.value)} className="flex-1 focus:outline-none text-sm text-gray-800" placeholder="recipient@example.com" />
                </div>
                
                <div className="flex border-b border-gray-100 pb-2 items-center">
                  <span className="text-sm text-gray-500 w-20">Subject</span>
                  <input type="text" value={composeSubject} onChange={e => setComposeSubject(e.target.value)} className="flex-1 focus:outline-none text-sm text-gray-800" placeholder="Message Subject" />
                </div>

                <div className="flex border-b border-gray-100 pb-2 items-center">
                  <span className="text-sm text-gray-500 w-20">Translate To</span>
                  <select
                    value={composeLang}
                    onChange={e => setComposeLang(e.target.value)}
                    className="text-sm border border-gray-200 rounded-md px-2 py-1 bg-gray-50 focus:outline-none"
                  >
                    {LANGUAGE_OPTIONS.map(language => (
                      <option key={language.code} value={language.code}>
                         {language.name} ({language.nativeName})
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-gray-400 ml-3">The email will be auto-translated to this language before sending.</span>
                </div>

                <textarea
                  value={composeBody}
                  onChange={e => setComposeBody(e.target.value)}
                  className="w-full flex-1 p-0 mt-4 text-sm text-gray-800 resize-none focus:outline-none min-h-[250px]"
                  placeholder="Type your message here..."
                ></textarea>
                
                <div className="mt-4 pt-4 flex items-center pb-6 border-t border-gray-100">
                  <button
                    onClick={() => handleGrammarCheck(composeBody, setComposeBody, setCheckingComposeGrammar)}
                    disabled={checkingComposeGrammar || !composeBody.trim()}
                    className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-md shadow-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors flex items-center gap-2 text-sm mr-auto"
                  >
                    {checkingComposeGrammar ? <Spinner /> : '✨ Check Grammar'}
                  </button>
                  <button
                    onClick={() => setComposing(false)}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800 text-sm font-medium transition-colors mr-3"
                  >
                    Discard
                  </button>
                  <button
                    onClick={handleSendCompose}
                    disabled={composeLoading || !composeTo.trim() || !composeBody.trim()}
                    className="px-6 py-2 bg-blue-600 text-white rounded-md shadow-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2 text-sm"
                  >
                    {composeLoading ? <><Spinner /> Sending...</> : 'Send & Translate'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto pb-10">
              {/* Email header */}
              <h1 className="text-xl md:text-2xl font-normal text-gray-800 mb-6 leading-snug">{selected.subject}</h1>
              <div className="flex items-start gap-3 mb-6 text-sm text-gray-500">
                <Avatar from={selected.from} size={44} />
                <div className="flex-1 overflow-hidden">
                  <div className="font-semibold text-gray-800 text-base">{selected.from.split('<')[0].trim()}</div>
                  <div className="truncate text-gray-500 text-xs mb-1">{selected.from.match(/<(.+)>/)?.[1] || selected.from}</div>
                  <div className="text-xs">{selected.date}</div>
                </div>
              </div>

              {/* Original body */}
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-5 mb-5 shadow-sm">
                <div className="text-xs text-gray-400 uppercase tracking-widest font-bold mb-3">Original Message</div>
                <div className="email-body text-sm text-gray-800 leading-relaxed whitespace-pre-wrap font-sans">{selected.body}</div>
              </div>

              {/* Translate button */}
              {!translations[selected.id] && (
                <button
                  onClick={() => handleTranslate(selected)}
                  disabled={loadingId === selected.id}
                  className="flex items-center gap-2 px-5 py-2.5 bg-[#4285F4] text-white rounded-md shadow-sm text-sm font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mb-6 mx-auto block"
                >
                  {loadingId === selected.id ? (
                    <><Spinner /> Translating...</>
                  ) : (
                    `Translate to ${prefLang}`
                  )}
                </button>
              )}

              {/* Translation result */}
              {translations[selected.id] && (
                <div className="bg-[#f0f9ff] rounded-xl border border-[#bae6fd] mb-6 shadow-sm overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between px-5 py-3 bg-[#e0f2fe] border-b border-[#bae6fd]">
                    <span className="text-xs font-bold text-[#0369a1] uppercase tracking-widest">
                      Translated to {prefLang}
                    </span>
                    <span className="text-xs text-[#0284c7] font-medium hidden sm:inline">
                      Auto-detected Language ~ {getLanguageDisplayName(
                        translations[selected.id].detectedLangCode || translations[selected.id].detectedLang
                      )}
                    </span>
                  </div>
                  <div className="p-5">
                    <div className="email-body text-sm text-gray-800 leading-relaxed whitespace-pre-wrap font-sans">
                      {translations[selected.id].translated}
                    </div>
                  </div>
                </div>
              )}

              {/* Reply box */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mt-8">
                <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-200">
                  <span className="text-xs font-bold text-gray-600 uppercase tracking-widest">
                    AI Reply Generator
                  </span>
                  {sentReplies[selected.id] && (
                    <span className="text-xs text-green-600 font-bold tracking-wide flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg> Sent via Gmail
                    </span>
                  )}
                </div>

                {sentReplies[selected.id] ? (
                  <div className="p-5 bg-green-50/50">
                    <div className="text-xs font-medium text-green-800 mb-2">Final Translated Email Sent:</div>
                    <div className="text-sm text-gray-700 email-body p-4 bg-white border border-green-100 rounded-lg shadow-sm">{sentReplies[selected.id]}</div>
                    <button
                      onClick={() => setSentReplies(s => { const n = {...s}; delete n[selected.id]; return n })}
                      className="mt-4 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors"
                    >
                      + Send another reply
                    </button>
                  </div>
                ) : (
                  <>
                    <textarea
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      placeholder={`Write a reply, or click '✨ AI Draft' to let Gemini write it. You can check grammar before sending.`}
                      className="w-full p-5 text-sm text-gray-800 resize-none focus:outline-none min-h-[140px]"
                    />
                    <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex flex-wrap items-center gap-3">
                      <button
                        onClick={() => handleAutoDraft(selected)}
                        className="px-4 py-2 text-sm font-medium text-blue-700 bg-white border border-blue-200 rounded-md shadow-sm hover:bg-blue-50 transition-colors flex items-center gap-1"
                        disabled={draftingReply}
                      >
                        {draftingReply ? <Spinner /> : '✨ AI Draft'}
                      </button>
                      <button
                        onClick={() => handleGrammarCheck(replyText, setReplyText, setCheckingGrammar)}
                        className="px-4 py-2 text-sm font-medium text-purple-700 bg-white border border-purple-200 rounded-md shadow-sm hover:bg-purple-50 transition-colors flex items-center gap-1"
                        disabled={checkingGrammar || !replyText.trim()}
                      >
                       {checkingGrammar ? <Spinner /> : '🔍 Check Grammar'}
                      </button>

                      <div className="ml-auto flex items-center gap-2">
                        <button
                          onClick={() => setReplyText('')}
                          className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
                          disabled={replyLoading}
                        >
                          Clear
                        </button>
                        <button
                          onClick={() => handleSendReply(selected)}
                          disabled={!replyText.trim() || replyLoading}
                          className="flex items-center gap-2 px-6 py-2 bg-gray-900 text-white rounded-md shadow flex-shrink-0 text-sm font-medium hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                          {replyLoading ? <><Spinner /> Sending safely...</> : 'Send Auto-Translated'}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
