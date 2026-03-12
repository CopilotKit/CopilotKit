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
  MapPin,
  ThumbsUp,
  Send
} from "lucide-react"
import { cn } from "@/lib/utils"

export interface LinkedInPostProps {
  title: string
  content: string
  className?: string
}

export function LinkedInPost({
  title,
  content,
  className,
}: LinkedInPostProps) {
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
    title: "AI Research Scientist",
    company: "Google DeepMind",
    avatar: "/placeholder-user.jpg",
    verified: true,
  }
  
  const defaultTimestamp = "2h"
  const defaultLocation = "London, UK"
  const defaultLikes = 1247
  const defaultComments = 89
  const defaultShares = 23
  const defaultViews = 45600

  return (
    <Card className={cn("w-full bg-white border border-gray-200/50 shadow-sm hover:shadow-md transition-shadow duration-200", className)}>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          <Avatar className="w-12 h-12">
            <AvatarImage src={defaultAuthor.avatar} alt={defaultAuthor.name} />
            <AvatarFallback className="bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold">
              {defaultAuthor.name.charAt(0)}
            </AvatarFallback>
          </Avatar>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-gray-900 text-sm truncate">
                {defaultAuthor.name}
              </span>
              {defaultAuthor.verified && (
                <div className="w-4 h-4 bg-blue-600 rounded-full flex items-center justify-center">
                  <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
              )}
            </div>
            
            <div className="text-gray-600 text-xs mb-1">
              <div>{defaultAuthor.title}</div>
              <div>{defaultAuthor.company}</div>
            </div>
            
            <div className="flex items-center gap-4 text-xs text-gray-500 mb-2">
              <div className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                <span>{defaultTimestamp}</span>
              </div>
              <div className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                <span>{defaultLocation}</span>
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

        {/* Engagement Stats */}
        <div className="flex items-center justify-between py-2 border-t border-gray-100 text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <div className="flex -space-x-1">
              <div className="w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center">
                <ThumbsUp className="w-3 h-3 text-white" />
              </div>
              <div className="w-5 h-5 bg-green-600 rounded-full flex items-center justify-center">
                <Heart className="w-3 h-3 text-white" />
              </div>
              <div className="w-5 h-5 bg-purple-600 rounded-full flex items-center justify-center">
                <span className="text-white text-xs font-bold">+</span>
              </div>
            </div>
            <span>{formatNumber(defaultLikes)}</span>
          </div>
          <div className="flex items-center gap-4">
            <span>{formatNumber(defaultComments)} comments</span>
            <span>{formatNumber(defaultShares)} shares</span>
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <Button 
            variant="ghost" 
            size="sm" 
            className="flex items-center gap-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50"
          >
            <ThumbsUp className="w-4 h-4" />
            <span className="text-xs">Like</span>
          </Button>
          
          <Button 
            variant="ghost" 
            size="sm" 
            className="flex items-center gap-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50"
          >
            <MessageCircle className="w-4 h-4" />
            <span className="text-xs">Comment</span>
          </Button>
          
          <Button 
            variant="ghost" 
            size="sm" 
            className="flex items-center gap-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50"
          >
            <Repeat2 className="w-4 h-4" />
            <span className="text-xs">Repost</span>
          </Button>
          
          <Button 
            variant="ghost" 
            size="sm" 
            className="flex items-center gap-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50"
          >
            <Send className="w-4 h-4" />
            <span className="text-xs">Send</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// LinkedIn Logo Component
export function LinkedInLogo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
        <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
        </svg>
      </div>
      <span className="font-bold text-xl text-blue-600">LinkedIn</span>
    </div>
  )
}

// LinkedIn Post Preview Component (for the canvas)
export function LinkedInPostPreview({title, content}: {title: string, content: string}) {
  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex items-center ml-4 mb-4">
        <LinkedInLogo />
        <Badge variant="outline" className="text-xs ml-2">
          Preview
        </Badge>
      </div>
      
      <div className="flex-1 w-full">
        <LinkedInPost title={title} content={content} />
      </div>
    </div>
  )
}

// Compact LinkedIn Post Component (for chat UI)
export function LinkedInPostCompact({
  title,
  content,
  className,
}: LinkedInPostProps) {
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
    title: "AI Research Scientist",
    company: "Google DeepMind",
    avatar: "/placeholder-user.jpg",
    verified: true,
  }
  
  const defaultTimestamp = "2h"
  const defaultLocation = "London, UK"
  const defaultLikes = 1247
  const defaultComments = 89
  const defaultShares = 23
  const defaultViews = 45600

  return (
    <Card className={cn("w-full max-w-sm bg-white border border-gray-200/50 shadow-sm", className)} style={{ transform: 'scale(0.9)', transformOrigin: 'top left' }}>
      <CardContent className="p-3">
        {/* Compact Indicator */}
        {/* <div className="text-xs text-blue-500 mb-1 font-medium">[Compact Version]</div> */}
        {/* Header */}
        <div className="flex items-start gap-2 mb-2">
          <Avatar className="w-8 h-8">
            <AvatarImage src={defaultAuthor.avatar} alt={defaultAuthor.name} />
            <AvatarFallback className="bg-gradient-to-r from-blue-600 to-blue-700 text-white text-xs font-semibold">
              {defaultAuthor.name.charAt(0)}
            </AvatarFallback>
          </Avatar>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 mb-1">
              <span className="font-semibold text-gray-900 text-xs truncate">
                {defaultAuthor.name}
              </span>
              {defaultAuthor.verified && (
                <div className="w-3 h-3 bg-blue-600 rounded-full flex items-center justify-center">
                  <svg className="w-1.5 h-1.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
              )}
            </div>
            
            <div className="text-gray-600 text-xs mb-1">
              <div>{defaultAuthor.title}</div>
              <div>{defaultAuthor.company}</div>
            </div>
            
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <div className="flex items-center gap-1">
                <Calendar className="w-2 h-2" />
                <span>{defaultTimestamp}</span>
              </div>
              <div className="flex items-center gap-1">
                <MapPin className="w-2 h-2" />
                <span>{defaultLocation}</span>
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

        {/* Engagement Stats */}
        <div className="flex items-center justify-between py-1 border-t border-gray-100 text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <div className="flex -space-x-1">
              <div className="w-4 h-4 bg-blue-600 rounded-full flex items-center justify-center">
                <ThumbsUp className="w-2 h-2 text-white" />
              </div>
              <div className="w-4 h-4 bg-green-600 rounded-full flex items-center justify-center">
                <Heart className="w-2 h-2 text-white" />
              </div>
              <div className="w-4 h-4 bg-purple-600 rounded-full flex items-center justify-center">
                <span className="text-white text-xs font-bold">+</span>
              </div>
            </div>
            <span>{formatNumber(defaultLikes)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span>{formatNumber(defaultComments)} comments</span>
            <span>{formatNumber(defaultShares)} shares</span>
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex items-center gap-11 pt-1 border-t border-gray-100">
          <Button 
            variant="ghost" 
            size="icon" 
            className="flex items-center gap-1 text-gray-500 hover:text-blue-600 hover:bg-blue-50 h-6 px-2"
          >
            <ThumbsUp className="w-2 h-2" />
            <span className="text-xs">Like</span>
          </Button>
          
          <Button 
            variant="ghost" 
            size="icon" 
            className="flex items-center gap-1 text-gray-500 hover:text-blue-600 hover:bg-blue-50 h-6 px-2"
          >
            <MessageCircle className="w-2 h-2" />
            <span className="text-xs">Comment</span>
          </Button>
          
          <Button 
            variant="ghost" 
            size="icon" 
            className="flex items-center gap-1 text-gray-500 hover:text-blue-600 hover:bg-blue-50 h-6 px-2"
          >
            <Repeat2 className="w-2 h-2" />
            <span className="text-xs">Repost</span>
          </Button> 
        </div>
      </CardContent>
    </Card>
  )
}
