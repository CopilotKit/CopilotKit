"use client";

import { cn } from "@/lib/utils";
import { gradient, commonPageClass } from "./ChapterPage";
import { Character, useStory } from "../lib/StoryProvider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEffect, useRef } from "react";
import { useCoagent } from "@copilotkit/react-core";
import { SparkleIcon, StarIcon } from "lucide-react";

export function CharactersPage() {
  const { characters, setCharacters } = useStory();
  const { state: story, setState: setStory } = useCoagent({
    name: "childrensBookAgent",
  });

  useEffect(() => {
    if (story?.characters) {
      setCharacters(story.characters);
    }
  }, [story?.characters, setCharacters]);

  return (
    <div className={cn(commonPageClass, "rounded-r-lg bg-white")}>
      <div
        className={
          "h-full font-story flex flex-col py-8 px-8 gap-y-8 overflow-scroll  pointer-events-auto"
        }
        style={{
          background: `linear-gradient(to left, ${gradient})`,
          backgroundRepeat: "repeat-y",
        }}
      >
        <div className="text-center text-xl font-medium whitespace-pre-wrap">
          Characters
        </div>

        <div className="flex flex-col gap-y-2 h-full">
          {characters.map((character, index) => (
            <CharacterItem
              key={index}
              character={character}
              onDelete={() => {
                setCharacters(characters.filter((_, i) => i !== index));
              }}
            />
          ))}

          {characters.length < 4 && (
            <div className="flex justify-center">
              <AddCharacterButton
                onAdd={(values) => {
                  // @ts-ignore
                  setCharacters([...characters, values]);
                  setStory({
                    ...story,
                    characters: [...(story.characters || []), values],
                  });
                }}
              />
            </div>
          )}
        </div>
        {/* <div className="w-full text-center">Page 2</div> */}
      </div>
    </div>
  );
}

export function CharacterItem({
  character,
  onDelete,
}: {
  character: Character;
  onDelete: () => void;
}) {
  return (
    <div className="border rounded-lg p-3 flex gap-x-4 gap-y-1">
      <div className="flex-1 space-y-1">
        <p className="text-lg font-medium">{character.name}</p>
        <p className="text-sm text-gray-500">{character.appearance}</p>
        <p className="text-sm text-gray-500 space-x-1 flex">
          {character.traits?.map((trait, index) => (
            <div
              key={index}
              className="py-1 px-2 bg-stone-200 rounded-md flex justify-center items-center gap-x-1"
            >
              <StarIcon className="w-3 h-3" />
              {trait}
            </div>
          ))}
        </p>
      </div>
      <div className="">
        <Button variant="link" onClick={onDelete}>
          X
        </Button>
      </div>
    </div>
  );
}

const addCharacterSchema = z.object({
  name: z.string().min(1, { message: "Name is required" }),
  appearance: z.string().min(1, { message: "Appearance is required" }),
  traits: z.string().min(1, { message: "Traits is required" }),
});

export function AddCharacterButton({
  onAdd,
}: {
  onAdd: (values: z.infer<typeof addCharacterSchema>) => void;
}) {
  const dialogRef = useRef<any>(null);

  const form = useForm<z.infer<typeof addCharacterSchema>>({
    resolver: zodResolver(addCharacterSchema),
    defaultValues: {
      name: "",
      appearance: "",
      traits: "",
    },
  });

  const onSubmit = (values: z.infer<typeof addCharacterSchema>) => {
    onAdd(values);
    dialogRef.current.click();
    form.reset();
  };

  return (
    <Dialog>
      <DialogTrigger asChild ref={dialogRef}>
        <Button className="rounded-lg px-4 py-2">+ Add Character</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Character</DialogTitle>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="flex flex-col gap-y-4"
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="appearance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Appearance</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. has blue eyes and a big smile"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="traits"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Traits</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. sweet, smart, funny"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="focus:outline-none">
                Add Character
              </Button>
            </form>
          </Form>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
