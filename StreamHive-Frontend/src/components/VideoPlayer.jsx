import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

/*
 VideoPlayer
 - Expects an uploadId that has finished transcoding (status = ready)
 - Uses PlaybackService endpoints:
    Master:   /playback/videos/:uploadId/master.m3u8
    Variants: /playback/videos/:uploadId/{1080p|720p|480p|360p}/index.m3u8
 - Provides a quality selector (Auto + explicit resolutions) using hls.js level controls.
 - Falls back to native HLS (Safari) and still supports manual selection by swapping variant playlist URLs.
 Environment variable:
    VITE_API_PLAYBACK (base URL of PlaybackService, WITHOUT trailing slash)
*/

export default function VideoPlayer({ uploadId }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [error, setError] = useState('');
  const [levels, setLevels] = useState([]); // [{index,height,bitrate,label}]
  const [selected, setSelected] = useState('auto');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [manualVariants, setManualVariants] = useState([]); // fallback for native HLS

  const base = (window.runtimeConfig.VITE_API_PLAYBACK || '').replace(/\/$/, '');

  // Fetch descriptor (title etc.) & parse master for fallback variants
  useEffect(() => {
    if (!uploadId) return;
    let aborted = false;
    (async () => {
      try {
        setTitle('');
        setManualVariants([]);
        const descUrl = `${base}/playback/videos/${uploadId}`;
        const r = await fetch(descUrl);
        if (r.ok) {
          const data = await r.json();
            if (!aborted) setTitle(data.title || uploadId);
        }
        // Fetch master to detect which renditions exist (for Safari fallback & UI pre-population)
        const masterUrl = `${base}/playback/videos/${uploadId}/master.m3u8`;
        const mr = await fetch(masterUrl);
        if (mr.ok) {
          const text = await mr.text();
          const found = Array.from(text.matchAll(/^(1080p|720p|480p|360p)\/index\.m3u8$/gm)).map(m => m[1]);
          if (!aborted) setManualVariants(found);
        }
      } catch (e) {
        if (!aborted) console.warn('Descriptor/master fetch error', e);
      }
    })();
    return () => { aborted = true; };
  }, [uploadId, base]);

  // Initialize playback
  useEffect(() => {
    const video = videoRef.current;
    setError('');
    setLevels([]);
    setSelected('auto');

    if (!video || !uploadId) return;

    const masterUrl = `${base}/playback/videos/${uploadId}/master.m3u8`;

    // Destroy previous instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    setLoading(true);

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        // you can tune here (maxBufferLength, capLevelToPlayerSize, etc.)
      });
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          setError(data.details || 'Fatal HLS error');
        }
      });
      hls.on(Hls.Events.LEVEL_LOADED, () => setLoading(false));
      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        // Build quality list
        const q = hls.levels.map((l, i) => ({
          index: i,
          height: l.height,
          bitrate: l.bitrate,
          label: l.height ? `${l.height}p` : `Level ${i}`
        }))
        // Sort descending height
        q.sort((a,b)=> (b.height||0)-(a.height||0));
        setLevels(q);
      });
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(masterUrl);
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari)
      video.src = masterUrl;
      video.addEventListener('loadedmetadata', () => setLoading(false), { once: true });
      video.load();
    } else {
      setError('HLS not supported in this browser');
      setLoading(false);
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [uploadId, base]);

  const onChangeQuality = (e) => {
    const val = e.target.value;
    setSelected(val);
    const hls = hlsRef.current;
    if (hls) {
      if (val === 'auto') {
        hls.currentLevel = -1; // auto
      } else {
        const levelObj = levels.find(l => l.label === val);
        if (levelObj) {
          // Find original index in hls.levels (we sorted; map by height)
          const idx = hls.levels.findIndex(l => l.height === levelObj.height);
          if (idx >= 0) hls.currentLevel = idx;
        }
      }
    } else {
      // Native fallback: switch to variant playlist directly
      const video = videoRef.current;
      if (!video) return;
      if (val === 'auto') {
        video.src = `${base}/playback/videos/${uploadId}/master.m3u8`;
      } else {
        const rendition = val.replace(/p$/, '');
        video.src = `${base}/playback/videos/${uploadId}/${rendition}/index.m3u8`;
      }
      video.load();
      video.play().catch(()=>{});
    }
  };

  if (!uploadId) {
    return <div className="text-sm text-gray-400">Select or upload a video to begin playback.</div>;
  }

  const qualityOptions = () => {
    if (levels.length) {
      return ['auto', ...levels.map(l => l.label)];
    }
    if (manualVariants.length) {
      return ['auto', ...manualVariants.map(r => r.replace(/^(\d+)$/,'$1p'))];
    }
    return ['auto'];
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-lg truncate" title={title}>{title || uploadId}</h2>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-gray-400">Quality:</label>
          <select value={selected} onChange={onChangeQuality} className="bg-gray-800 rounded px-2 py-1 text-sm">
            {qualityOptions().map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </div>
      </div>
      <div className="relative">
        <video
          ref={videoRef}
          className="w-full max-h-[420px] bg-black rounded"
          controls
          playsInline
        />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm">Loading stream...</div>
        )}
      </div>
      {error && <div className="text-red-400 text-xs">{error}</div>}
    </div>
  );
}
