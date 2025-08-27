import React, { useEffect, useState } from 'react';

export default function VideoList({ onPlay }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [debugInfo, setDebugInfo] = useState('Component initialized');
  const [deleting, setDeleting] = useState(new Set());

  const loadVideos = async () => {
    try {
      const apiUrl = `${window.runtimeConfig.VITE_API_CATALOG}/videos?page=1`;
      setDebugInfo(`Fetching from: ${apiUrl}`);
      const r = await fetch(apiUrl);
      setDebugInfo(`Response: ${r.status} ${r.ok ? 'OK' : 'Error'}`);
      if (r.ok) {
        const data = await r.json();
        setVideos(data.videos || []);
        setDebugInfo(`Loaded ${data.videos?.length || 0} videos`);
      } else {
        setDebugInfo(`API Error: ${r.status}`);
      }
    } catch (error) {
      setDebugInfo(`Fetch Error: ${error.message}`);
    } finally { 
      setLoading(false); 
    }
  };

  const deleteVideo = async (videoId) => {
    if (!window.confirm('Delete this video permanently?')) return;
    setDeleting(prev => new Set(prev.add(videoId)));
    try {
      const endpoint = `${window.runtimeConfig.VITE_API_CATALOG}/videos/${videoId}`;
      const response = await fetch(endpoint, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
      if (response.ok) {
        setVideos(prev => prev.filter(v => v.id !== videoId));
      } else {
        const error = await response.json();
        alert(`Failed to delete: ${error.error || 'Unknown error'}`);
      }
    } catch (error) {
      alert(`Error deleting: ${error.message}`);
    } finally {
      setDeleting(prev => { const s = new Set(prev); s.delete(videoId); return s; });
    }
  };

  useEffect(() => { loadVideos(); }, []);

  if (loading) {
    return (
      <div>
        <div className="text-sm text-slate-400 mb-3">Loading videos…</div>
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="surface animate-pulse p-3">
              <div className="rounded-lg bg-slate-700/50 aspect-video mb-3" />
              <div className="h-4 bg-slate-700/50 rounded w-3/4" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (!videos.length) {
    return <div className="mt-2 text-sm text-slate-400">No videos found. <br/><small>Debug: {debugInfo}</small></div>;
  }
  
  return (
    <div>
      <div className="text-slate-200 font-semibold mb-3">Your Library</div>
      <div className="grid gap-4 md:grid-cols-3">
        {videos.map(v => {
          const ready = v.status === 'ready';
          const isDeleting = deleting.has(v.id);
          const thumbnailEndpoint = `${window.runtimeConfig.VITE_API_PLAYBACK}/playback/videos/${v.upload_id}/thumbnail.jpg`;

          return (
            <div
              key={v.upload_id}
              className="surface p-3 transition hover:translate-y-[-2px] hover:shadow-2xl"
            >
              <div
                className={`mb-2 relative aspect-video w-full overflow-hidden rounded-lg bg-slate-800/70 grid place-items-center text-xs text-slate-400`}
                onClick={() => ready && onPlay(v.upload_id)}
                title={ready ? 'Play' : 'Processing'}
              >
                {ready && window.runtimeConfig.VITE_API_PLAYBACK ? (
                  <img
                    src={thumbnailEndpoint}
                    alt={v.title}
                    className="object-cover w-full h-full"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                ) : (
                  <div>{ready ? 'No thumbnail' : 'Processing…'}</div>
                )}
              </div>

              <div className="font-semibold truncate" title={v.title}>{v.title}</div>
              <div className="text-xs text-slate-400 flex gap-2 items-center mb-3 mt-1">
                <span>{v.category || 'Uncategorized'}</span>
                <span className={ready ? 'badge-success' : 'badge-warn'}>{v.status}</span>
              </div>
              
              <div className="flex gap-2">
                <button 
                  disabled={!ready || isDeleting} 
                  onClick={() => ready && onPlay(v.upload_id)} 
                  className={!ready || isDeleting ? 'btn-muted w-full' : 'btn-primary w-full'}
                >
                  {ready ? 'Play' : 'Processing'}
                </button>
                <button 
                  disabled={isDeleting}
                  onClick={() => deleteVideo(v.id)} 
                  className="btn-danger px-3"
                  title="Delete video"
                >
                  {isDeleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-xs text-slate-500">Debug: {debugInfo}</div>
    </div>
  );
}
