"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Code, Play, FileText, Lightbulb, Bug } from "lucide-react"

interface CoderWorkspaceProps {
  // content: string
  haikus: Haiku[]
  setContent: (content: string) => void
  lastMessage: string
  isAgentActive: boolean
}

interface Haiku {
  japanese: string[];
  english: string[];
  image_names: string[];
  selectedImage: string | null;
}

export function CoderWorkspace({ haikus, setContent, lastMessage, isAgentActive }: CoderWorkspaceProps) {



  // const [haikus, setHaikus] = useState<Haiku[]>([{
  //   japanese: ["仮の句よ", "まっさらながら", "花を呼ぶ"],
  //   english: [
  //     "A placeholder verse—",
  //     "even in a blank canvas,",
  //     "it beckons flowers.",
  //   ],
  //   image_names: [],
  //   selectedImage: null,
  // }])

  


  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
      {/* Code Editor */}
      <div className="lg:col-span-3 space-y-6">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="text-xl">Haiku Canvas</CardTitle>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex-1 p-8 flex items-center justify-center " style={{ marginLeft: '-48px' }}>
              <div className="haiku-stack">
                {haikus.map((haiku, index) => (
                  <div
                    key={index}
                    // className={`haiku-card animated-fade-in ${isJustApplied && index === activeIndex ? 'applied-flash' : ''} ${index === activeIndex ? 'active' : ''}`}
                    className={`haiku-card`}
                  // onClick={() => setActiveIndex(index)}
                  >
                    {haiku?.japanese.map((line, lineIndex) => (
                      <div
                        className="flex items-start gap-4 mb-4 haiku-line"
                        key={lineIndex}
                      // style={{ animationDelay: `${lineIndex * 0.1}s` }}
                      >
                        <p className="text-4xl font-bold text-gray-600 w-auto">{line}</p>
                        <p className="text-base font-light text-gray-600 w-auto">{haiku?.english?.[lineIndex]}</p>
                      </div>
                    ))}

                    {haiku?.image_names && haiku?.image_names.length === 3 && (
                      <div className="mt-6 flex gap-4 justify-center">
                        {haiku?.image_names.map((imageName, imgIndex) => (
                          <img
                            key={imageName}
                            src={`/images/${imageName}`}
                            alt={imageName || ""}
                            style={{
                              width: '130px',
                              height: '130px',
                              objectFit: 'cover',
                            }}
                            className={(haiku?.selectedImage === imageName) ? `suggestion-card-image-focus` : `haiku-card-image`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* File Explorer & Tools */}
      <div className="space-y-6">
        {/* File Explorer */}
        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Haikus</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                <div className="haiku-stack">
                  {haikus.map((haiku, index) => (
                    <div
                      key={index}
                      // className={`haiku-card animated-fade-in ${isJustApplied && index === activeIndex ? 'applied-flash' : ''} ${index === activeIndex ? 'active' : ''}`}
                      className={`haiku-card animated-fade-in applied-flash active`}
                      style={{
                        margin: "0 auto",
                        width: "90%",
                        maxWidth: "320px",
                        transform: "scale(0.35)",
                        transformOrigin: "top left",
                      }}
                    // onClick={() => setActiveIndex(index)}
                    >
                      {haiku?.japanese.map((line, lineIndex) => (
                        <div
                          className="flex items-start gap-4 mb-4 haiku-line"
                          key={lineIndex}
                          style={{ animationDelay: `${lineIndex * 0.1}s` }}
                        >
                          <p className="text-4xl font-bold text-gray-600 w-auto">{line}</p>
                          <p className="text-base font-light text-gray-500 w-auto">{haiku?.english?.[lineIndex]}</p>
                        </div>
                      ))}
                      {haiku?.image_names && haiku?.image_names.length === 3 && (
                        <div className="mt-6 flex gap-4 justify-center">
                          {haiku?.image_names.map((imageName, imgIndex) => (
                            <img
                              key={imageName}
                              src={`/images/${imageName}`}
                              alt={imageName || ""}
                              style={{
                                width: '130px',
                                height: '130px',
                                objectFit: 'cover',
                              }}
                              className={(haiku?.selectedImage === imageName) ? `suggestion-card-image-focus` : `haiku-card-image`}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </ScrollArea>
          </CardContent>
        </Card>



      </div>
    </div>
  )
}
