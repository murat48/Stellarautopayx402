const FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfp4qWFnQUWYiruEyvELlv1RJkK7_Q7UtrEXu4Ze-QmYMtb8A/viewform?embedded=true';

export default function FeedbackForm({ onClose }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal feedback-modal">
        <div className="modal-header">
          <h2>💬 Share Your Feedback</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="feedback-iframe-wrapper">
          <iframe
            src={FORM_URL}
            title="Stellar Autopay Feedback"
            frameBorder="0"
            marginHeight="0"
            marginWidth="0"
            allowFullScreen
          >
            Loading…
          </iframe>
        </div>
      </div>
    </div>
  );
}
