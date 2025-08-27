import React, { useState } from "react";
import VideoPlayer from "./VideoPlayer.jsx";
import VideoList from "./VideoList.jsx";
import "./home.css";

export default function Home({ onNavigateUpload }) {
  const [selectedVideo, setSelectedVideo] = useState(null);

  return (
    <div className="home-page p-4 md:p-6">
      {/* Header with Upload button on right */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold">All Videos</h2>
        <button
          onClick={onNavigateUpload}
          className="ml-56 bg-red-600 text-white px-4 py-2 rounded-full font-semibold hover:bg-red-700 transition"
        >
          ⬆ Upload Video
        </button>
      </div>

      {/* Main Video Player */}
      <div className="main-video-card card mb-6">
        {selectedVideo ? (
          <VideoPlayer uploadId={selectedVideo} />
        ) : (
          <div className="flex justify-center items-center h-64 text-gray-500">
            Select a video to play
          </div>
        )}
      </div>

      {/* Video Library */}
      <div className="video-library card">
        <VideoList onPlay={(id) => setSelectedVideo(id)} />
      </div>
    </div>
  );
}
