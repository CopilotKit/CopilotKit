"use client"

import React from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { 
  Heart, 
  MessageCircle, 
  Repeat2, 
  Share, 
  MoreHorizontal,
  ExternalLink,
  Calendar,
  MapPin
} from "lucide-react"
import { cn } from "@/lib/utils"

export interface XPostProps {
  title: string
  content: string
  className?: string
}

export function XPost({
  title,
  content,
  className,
}: XPostProps) {
  const formatNumber = (num: number): string => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + "M"
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + "K"
    }
    return num.toString()
  }

  // Default values for demo purposes
  const defaultAuthor = {
    name: "DeepMind Research",
    handle: "deepmind_research",
    avatar: "/placeholder-user.jpg",
    verified: true,
  }
  
  const defaultTimestamp = "2h"
  const defaultLocation = "London, UK"
  const defaultLikes = 1247
  const defaultRetweets = 89
  const defaultReplies = 23
  const defaultViews = 45600

  return (
    <Card className={cn("w-full max-w-md bg-white border border-gray-200/50 shadow-sm hover:shadow-md transition-shadow duration-200", className)}>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          <Avatar className="w-10 h-10">
            <AvatarImage src={defaultAuthor.avatar} alt={defaultAuthor.name} />
            <AvatarFallback className="bg-gradient-to-r from-blue-400 to-purple-500 text-white font-semibold">
              {defaultAuthor.name.charAt(0)}
            </AvatarFallback>
          </Avatar>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-gray-900 text-sm truncate">
                {defaultAuthor.name}
              </span>
              {defaultAuthor.verified && (
                <div className="w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                  <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
              )}
              <span className="text-gray-500 text-sm">@{defaultAuthor.handle}</span>
              <span className="text-gray-400">·</span>
              <span className="text-gray-500 text-sm">{defaultTimestamp}</span>
            </div>
            
            <div className="flex items-center gap-4 text-xs text-gray-500 mb-2">
              <div className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                <span>{defaultLocation}</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 bg-gray-400 rounded-full"></div>
                <span>{formatNumber(defaultViews)} views</span>
              </div>
            </div>
          </div>
          
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </div>

        {/* Title */}
        <div className="mb-2">
          <h3 className="font-semibold text-gray-900 text-base">
            {title}
          </h3>
        </div>

        {/* Content */}
        <div className="mb-3">
          <p className="text-gray-900 text-sm leading-relaxed whitespace-pre-wrap">
            {content}
          </p>
        </div>

        {/* Action Bar */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <Button 
            variant="ghost" 
            size="sm" 
            className="flex items-center gap-2 text-gray-500 hover:text-blue-500 hover:bg-blue-50"
          >
            <MessageCircle className="w-4 h-4" />
            <span className="text-xs">{formatNumber(defaultReplies)}</span>
          </Button>
          
          <Button 
            variant="ghost" 
            size="sm" 
            className="flex items-center gap-2 text-gray-500 hover:text-green-600 hover:bg-green-50"
          >
            <Repeat2 className="w-4 h-4" />
            <span className="text-xs">{formatNumber(defaultRetweets)}</span>
          </Button>
          
          <Button 
            variant="ghost" 
            size="sm" 
            className="flex items-center gap-2 text-gray-500 hover:text-red-500 hover:bg-red-50"
          >
            <Heart className="w-4 h-4" />
            <span className="text-xs">{formatNumber(defaultLikes)}</span>
          </Button>
          
          <Button 
            variant="ghost" 
            size="sm" 
            className="flex items-center gap-2 text-gray-500 hover:text-blue-500 hover:bg-blue-50"
          >
            <Share className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// X Logo Component
export function XLogo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
        <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
      </div>
      <span className="font-bold text-xl text-gray-900">X</span>
    </div>
  )
}

// X Post Preview Component (for the canvas)
export function XPostPreview({title, content}: {title: string, content: string}) {
//   const samplePost = {
//     title: "AI Research Breakthrough",
//     content: "🚀 Exciting breakthrough in AI research! Our latest paper on multimodal reasoning shows significant improvements in complex problem-solving tasks. The integration of vision and language models opens new possibilities for scientific discovery.\n\n#AI #Research #DeepMind #Breakthrough"
//   }

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex items-center ml-4 mb-4">
        <XLogo />
        <Badge variant="outline" className="text-xs ml-2">
          Preview
        </Badge>
      </div>
      
      <div className="flex-1">
        <XPost title={title} content={content} />
      </div>
    </div>
  )
}

// Compact X Post Component (for chat UI)
export function XPostCompact({
  title,
  content,
  className,
}: XPostProps) {
  const formatNumber = (num: number): string => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + "M"
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + "K"
    }
    return num.toString()
  }

  // Default values for demo purposes
  const defaultAuthor = {
    name: "DeepMind Research",
    handle: "deepmind_research",
    avatar: "/placeholder-user.jpg",
    verified: true,
  }
  
  const defaultTimestamp = "2h"
  const defaultLocation = "London, UK"
  const defaultLikes = 1247
  const defaultRetweets = 89
  const defaultReplies = 23
  const defaultViews = 45600

  return (
    <Card className={cn("w-full max-w-sm bg-white border border-gray-200/50 shadow-sm", className)} style={{ transform: 'scale(0.9)', transformOrigin: 'top left' }}>
      <CardContent className="p-3">
        {/* Compact Indicator */}
        {/* <div className="text-xs text-blue-500 mb-1 font-medium">[Compact Version]</div> */}
        {/* Header */}
        <div className="flex items-start gap-2 mb-2">
          <Avatar className="w-6 h-6">
            <AvatarImage src={defaultAuthor.avatar} alt={defaultAuthor.name} />
            <AvatarFallback className="bg-gradient-to-r from-blue-400 to-purple-500 text-white text-xs font-semibold">
              {defaultAuthor.name.charAt(0)}
            </AvatarFallback>
          </Avatar>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 mb-1">
              <span className="font-semibold text-gray-900 text-xs truncate">
                {defaultAuthor.name}
              </span>
              {defaultAuthor.verified && (
                <div className="w-3 h-3 bg-blue-500 rounded-full flex items-center justify-center">
                  <svg className="w-1.5 h-1.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
              )}
              <span className="text-gray-500 text-xs">@{defaultAuthor.handle}</span>
              <span className="text-gray-400">·</span>
              <span className="text-gray-500 text-xs">{defaultTimestamp}</span>
            </div>
            
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <div className="flex items-center gap-1">
                <MapPin className="w-2 h-2" />
                <span>{defaultLocation}</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                <span>{formatNumber(defaultViews)} views</span>
              </div>
            </div>
          </div>
        </div>

        {/* Title */}
        <div className="mb-2">
          <h3 className="font-semibold text-gray-900 text-sm">
            {title}
          </h3>
        </div>

        {/* Content */}
        <div className="mb-2">
          <p className="text-gray-900 text-xs leading-relaxed whitespace-pre-wrap overflow-hidden" style={{
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical'
          }}>
            {content}
          </p>
        </div>

        {/* Action Bar */}
        <div className="flex items-center justify-between pt-1 border-t border-gray-100">
          <Button 
            variant="ghost" 
            size="sm" 
            className="flex items-center gap-1 text-gray-500 hover:text-blue-500 hover:bg-blue-50 h-6 px-2"
          >
            <MessageCircle className="w-3 h-3" />
            <span className="text-xs">{formatNumber(defaultReplies)}</span>
          </Button>
          
          <Button 
            variant="ghost" 
            size="sm" 
            className="flex items-center gap-1 text-gray-500 hover:text-green-600 hover:bg-green-50 h-6 px-2"
          >
            <Repeat2 className="w-3 h-3" />
            <span className="text-xs">{formatNumber(defaultRetweets)}</span>
          </Button>
          
          <Button 
            variant="ghost" 
            size="sm" 
            className="flex items-center gap-1 text-gray-500 hover:text-red-500 hover:bg-red-50 h-6 px-2"
          >
            <Heart className="w-3 h-3" />
            <span className="text-xs">{formatNumber(defaultLikes)}</span>
          </Button>
          
          <Button 
            variant="ghost" 
            size="sm" 
            className="flex items-center gap-1 text-gray-500 hover:text-blue-500 hover:bg-blue-50 h-6 px-2"
          >
            <Share className="w-3 h-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
