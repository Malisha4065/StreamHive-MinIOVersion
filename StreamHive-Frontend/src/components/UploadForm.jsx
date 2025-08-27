import React, { useState } from 'react';

export default function UploadForm({ onUploaded, jwt }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [category, setCategory] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!file) { setError('Select a file'); return; }
    setError('');
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('video', file);
      fd.append('title', title);
      fd.append('description', description);
      fd.append('tags', tags);
      fd.append('category', category);
      fd.append('isPrivate', isPrivate);
      const r = await fetch(window.runtimeConfig.VITE_API_UPLOAD, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + jwt },
        body: fd
      });
      if (!r.ok) throw new Error('Upload failed');
      const data = await r.json();
      onUploaded(data.uploadId);
      // reset fields (optional)
      setTitle(''); setDescription(''); setTags(''); setCategory(''); setIsPrivate(false); setFile(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-200">Upload video</h2>

      <label className="block">
        <span className="block text-sm text-slate-300 mb-1">Video file</span>
        <input type="file" accept="video/*" onChange={e=>setFile(e.target.files[0])}
               className="file:mr-4 file:rounded-lg file:border-0 file:bg-indigo-600 file:text-white file:px-4 file:py-2 file:hover:bg-indigo-500
                          text-slate-300 bg-slate-800/60 border border-white/10 rounded-xl w-full p-2" />
      </label>

      <div className="grid md:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm text-slate-300 mb-1">Title</span>
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Title" className="input" />
        </label>
        <label className="block">
          <span className="block text-sm text-slate-300 mb-1">Category</span>
          <input value={category} onChange={e=>setCategory(e.target.value)} placeholder="Category" className="input" />
        </label>
      </div>

      <label className="block">
        <span className="block text-sm text-slate-300 mb-1">Description</span>
        <textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="What’s inside?" className="textarea" />
      </label>

      <label className="block">
        <span className="block text-sm text-slate-300 mb-1">Tags</span>
        <input value={tags} onChange={e=>setTags(e.target.value)} placeholder="comma,separated,tags" className="input" />
      </label>

      <label className="flex items-center gap-2 text-slate-300">
        <input type="checkbox" className="check" checked={isPrivate} onChange={e=>setIsPrivate(e.target.checked)} />
        Private
      </label>

      {error && <div className="text-rose-300 text-sm">{error}</div>}

      <button disabled={busy} className={busy ? "btn-muted w-full" : "btn-primary w-full"}>
        {busy ? 'Uploading…' : 'Upload'}
      </button>
    </form>
  );
}
