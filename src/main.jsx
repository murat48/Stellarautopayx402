import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import PaymentPage from './PaymentPage.jsx'

const isPaymentPage = window.location.pathname.startsWith('/pay/')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isPaymentPage ? <PaymentPage /> : <App />}
  </StrictMode>,
)
