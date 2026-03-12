"use client";

import { Character, Background, Scene } from "@/lib/types";
import { useChatInput } from "@/lib/chat-input-context";

interface ArtifactPanelProps {
  characters: Character[];
  backgrounds: Background[];
  scenes: Scene[];
}

export function ArtifactPanel({ characters, backgrounds, scenes }: ArtifactPanelProps) {
  const { setInputValue } = useChatInput();

  const handleEdit = (type: string, id: string) => {
    setInputValue(`[EDIT ${type} ${id}]: `);
  };
  const hasArtifacts = characters.length > 0 || backgrounds.length > 0 || scenes.length > 0;

  return (
    <div className="flex-1 p-8 overflow-auto bg-grid-pattern">
      {!hasArtifacts ? (
        <EmptyState />
      ) : (
        <div className="space-y-12 pb-20">
          {scenes.length > 0 && (
            <ArtifactSection title="Scenes" count={scenes.length}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {scenes.map((scene) => (
                  <ArtifactCard key={scene.id} title={scene.name} type="SCENE" onEdit={() => handleEdit("scene", scene.id)}>
                    {scene.imageUrl ? (
                      <img src={scene.imageUrl} alt={scene.name} className="w-full h-64 object-cover border-b-2 border-black" />
                    ) : (
                      <div className="w-full h-64 bg-neutral-100 border-b-2 border-black flex items-center justify-center text-neutral-400 text-sm uppercase tracking-widest">
                        // Generating_Scene_Data...
                      </div>
                    )}
                  </ArtifactCard>
                ))}
              </div>
            </ArtifactSection>
          )}

          {characters.length > 0 && (
            <ArtifactSection title="Characters" count={characters.length}>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {characters.map((character) => (
                  <ArtifactCard key={character.id} title={character.name} type="CHAR" onEdit={() => handleEdit("character", character.id)}>
                    {character.imageUrl ? (
                      <img src={character.imageUrl} alt={character.name} className="w-full h-48 object-cover border-b-2 border-black" />
                    ) : (
                      <div className="w-full h-48 bg-neutral-100 border-b-2 border-black flex items-center justify-center text-neutral-400 text-xs uppercase">
                        [Loading...]
                      </div>
                    )}
                  </ArtifactCard>
                ))}
              </div>
            </ArtifactSection>
          )}

          {backgrounds.length > 0 && (
            <ArtifactSection title="Locations" count={backgrounds.length}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {backgrounds.map((background) => (
                  <ArtifactCard key={background.id} title={background.name} type="BG" onEdit={() => handleEdit("background", background.id)}>
                    {background.imageUrl ? (
                      <img src={background.imageUrl} alt={background.name} className="w-full h-48 object-cover border-b-2 border-black" />
                    ) : (
                      <div className="w-full h-48 bg-neutral-100 border-b-2 border-black flex items-center justify-center text-neutral-400 text-xs uppercase">
                        [Loading...]
                      </div>
                    )}
                  </ArtifactCard>
                ))}
              </div>
            </ArtifactSection>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-8 border-4 border-dashed border-neutral-300 m-8">
      <div className="w-24 h-24 mb-6 border-4 border-black flex items-center justify-center bg-[var(--accent-yellow)] shadow-[8px_8px_0px_0px_black]">
        <span className="text-4xl">?</span>
      </div>
      <h2 className="text-3xl font-bold uppercase tracking-tighter mb-4">No Data Found</h2>
      <p className="text-black max-w-md bg-white p-4 border-2 border-black shadow-[4px_4px_0px_0px_black]">
        Initiate sequence by requesting a character or background generation from the terminal.
      </p>
    </div>
  );
}

function ArtifactSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-end gap-4 mb-6 border-b-4 border-black pb-2">
        <h2 className="text-4xl font-bold uppercase tracking-tighter leading-none">{title}</h2>
        <span className="text-lg font-bold text-[var(--accent-red)] mb-1">
          [{count.toString().padStart(2, '0')}]
        </span>
      </div>
      {children}
    </section>
  );
}

function ArtifactCard({ title, type, children, onEdit }: { title: string; type: string; children: React.ReactNode; onEdit?: () => void }) {
  return (
    <div className="brutalist-card group relative bg-white">
      <div className="absolute top-2 left-2 z-10 bg-black text-white text-xs font-bold px-2 py-1">
        {type}
      </div>
      {children}
      <div className="p-4 flex items-center justify-between gap-4">
        <p className="font-bold truncate uppercase tracking-tight flex-1" title={title}>{title}</p>
        {onEdit && (
          <button
            onClick={onEdit}
            className="brutalist-btn bg-white px-2 py-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
            title="Edit Artifact"
          >
            EDIT
          </button>
        )}
      </div>
    </div>
  );
}