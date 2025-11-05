'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

interface SignUpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SignUpModal({ isOpen, onClose }: SignUpModalProps) {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    
    const formData = new FormData(e.currentTarget);
    
    const googleFormData = new URLSearchParams({
      'emailAddress': formData.get('email') as string,
      'entry.1290156474': formData.get('firstName') as string,
      'entry.1049782441': formData.get('lastName') as string,
    });
    
    try {
      if (process.env.NODE_ENV === 'development') {
        console.log('Submitting form data');
      }
      
      await fetch(
        'https://docs.google.com/forms/d/e/1FAIpQLSeEXhJ4cXv8CMU3qrUBG9AcvuBzvamkjS7IarcN5RxVhcPNPg/formResponse',
        {
          method: 'POST',
          mode: 'no-cors',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: googleFormData,
        }
      );
      
      setSubmitted(true);
      
      // Close modal after 2 seconds on success
      setTimeout(() => {
        onClose();
        setSubmitted(false);
      }, 2000);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div 
        className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          {/* Header */}
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                CopilotKit v1.50 Early Access
              </h2>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Submit your name and email below to be one of the first to experience v1.50.
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              aria-label="Close modal"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Video Preview */}
          <div className="mb-6 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800">
            <video 
              className="w-full"
              controls
              autoPlay
              muted
              loop
              playsInline
            >
              <source 
                src="https://screen-studio-shareable-links.67aa83ffa7fb557cd114a7156fca4e73.r2.cloudflarestorage.com/uI230JNX-video.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=363e5c20253db1195c87384f6dfb4c99%2F20251104%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20251104T234536Z&X-Amz-Expires=7200&X-Amz-Signature=6c14085a1dcd05652c293ef903dc95df8ad77468a7fa406682c05d652bf1cf6b&X-Amz-SignedHeaders=host&x-id=GetObject" 
                type="video/mp4" 
              />
              Your browser does not support the video tag.
            </video>
          </div>

          {/* Success State */}
          {submitted ? (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6 text-center">
              <h3 className="text-xl font-bold text-green-800 dark:text-green-300 mb-2">
                Thanks for signing up! 🎉
              </h3>
              <p className="text-green-700 dark:text-green-400">
                You'll be one of the first to experience CopilotKit v1.50.
              </p>
            </div>
          ) : (
            /* Form */
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">
                  Email *
                </label>
                <input 
                  id="email"
                  name="email"
                  type="email"
                  required
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  placeholder="your@email.com"
                />
              </div>
              
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">
                  First Name *
                </label>
                <input 
                  id="firstName"
                  name="firstName"
                  type="text"
                  required
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  placeholder="John"
                />
              </div>
              
              <div>
                <label htmlFor="lastName" className="block text-sm font-medium mb-2 text-gray-900 dark:text-white">
                  Last Name *
                </label>
                <input 
                  id="lastName"
                  name="lastName"
                  type="text"
                  required
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  placeholder="Doe"
                />
              </div>
              
              <button 
                type="submit"
                disabled={loading}
                className="w-full bg-purple-600 text-white py-2 px-4 rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors font-medium"
              >
                {loading ? 'Submitting...' : 'Submit'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

