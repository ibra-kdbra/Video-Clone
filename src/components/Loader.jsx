const Loader = ({ label = 'Loading...' }) => (
  <div style={{ 
    minHeight: '40vh', 
    display: 'flex', 
    flexDirection: 'column', 
    alignItems: 'center', 
    justifyContent: 'center',
    gap: '1rem' 
  }}>
    <div className="spinner" />
    <p style={{ color: '#aaaaaa', fontSize: '0.9rem' }}>{label}</p>
    
    <style>{`
      .spinner {
        width: 40px;
        height: 40px;
        border: 3px solid rgba(255, 0, 0, 0.1);
        border-top: 3px solid #ff0000;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `}</style>
  </div>
);

export default Loader;
