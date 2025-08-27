import React, { useState } from 'react';
import UploadForm from './components/UploadForm.jsx';
import VideoPlayer from './components/VideoPlayer.jsx';
import VideoList from './components/VideoList.jsx';
import StatusPoller from './components/StatusPoller.jsx';
import Login from './components/Login.jsx';
import Footer from './components/Footer.jsx';
import Home from './components/Home.jsx';
import './components/login.css'; // Optional if using custom CSS

export default function App() {
  const [currentUploadId, setCurrentUploadId] = useState('');
  const [playbackId, setPlaybackId] = useState('');
  const [jwt, setJwt] = useState('');
  const [page, setPage] = useState('home');
  
  const handleLogin = (token) => {
    setJwt(token);
    window.runtimeConfig.VITE_JWT = token;
  };

  return (
    <div className="app-wrap">
      {/* Header */}
      <header className="mb-6">
        <div className="flex items-center justify-between">
          {/* Left - Logo + App Name */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-white/10 grid place-items-center border border-white/10 shadow">
              <span className="text-lg">🎬</span>
            </div>
            <h1 className="text-2xl font-bold">
              <span className="title-gradient">StreamHive</span>
            </h1>
          </div>

          {/* Right - User Profile + Logout */}
          {jwt && (
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-indigo-600 grid place-items-center text-white font-bold">
                {window.runtimeConfig?.username?.[0]?.toUpperCase() || "U"}
              </div>

              <button
                onClick={() => {
                  setJwt("");
                  window.runtimeConfig.VITE_JWT = "";
                  window.location.reload(); // optional
                }}
                className="btn-ghost"
              >
                Logout
              </button>
            </div>
          )}
        </div>
        <div className="hr-glow mt-4" />
      </header>

      {/* Body */}
      <main className="space-y-6">
        {!jwt ? (
          <div className="grid place-items-center min-h-[60vh]">
            <div className="card max-w-md w-full">
              <Login onLogin={handleLogin} />
            </div>
          </div>
        ) : page === 'home' ? (
          <Home onNavigateUpload={() => setPage('dashboard')} />
        ) : (
          <>
            <div className="grid gap-6 md:grid-cols-2">
              <div className="card">
                <UploadForm onUploaded={setCurrentUploadId} jwt={jwt} />
                <StatusPoller uploadId={currentUploadId} onReady={setPlaybackId} />
              </div>
              <div className="card">
                <VideoPlayer uploadId={playbackId} />
              </div>
            </div>

            {/* Video Library */}
            <div className="card">
              <VideoList onPlay={setPlaybackId} />
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}

