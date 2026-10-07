import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { ConfirmProvider } from './ui'
import { UpdatePrompt, offerUpdate } from './UpdatePrompt'
import './styles.css'
const qc = new QueryClient({ defaultOptions: { queries: { networkMode: 'always', refetchOnWindowFocus: true, retry: 1 }, mutations: { networkMode: 'always' } } })
const update = registerSW({ onNeedRefresh() { offerUpdate(() => update(true)) } })
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={qc}><BrowserRouter><ConfirmProvider><App /><UpdatePrompt /></ConfirmProvider></BrowserRouter></QueryClientProvider>)
