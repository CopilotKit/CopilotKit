"use client";

import { useState, useEffect } from "react";
import {
  Container,
  Title,
  Grid,
  Card,
  Text,
  Badge,
  Group,
  Stack,
  Box,
  Modal,
  List,
} from "@mantine/core";
import { BookOpen } from "lucide-react";
import { Post } from "@/app/lib/types/post";
import { fetchPosts } from "@/app/ui/service";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { useRenderToolCall } from "@copilotkit/react-core";
import { z } from "zod";

export default function KnowledgeBase() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);

  useEffect(() => {
    const loadPosts = async () => {
      try {
        const data = await fetchPosts();
        setPosts(data);
      } catch (error) {
        console.error("Error loading posts:", error);
      } finally {
        setLoading(false);
      }
    };
    loadPosts();
  }, []);

  useRenderToolCall({
    name: "FetchKnowledgebaseArticles",
    description: "Fetch relevant knowledge base articles based on a user query",
    parameters: z.object({
      query: z.string().describe("User query for the knowledge base")
    }),
    render: "Getting relevant answers to your query...",
  });

  const handlePostClick = (post: Post) => {
    setSelectedPost(post);
  };

  if (loading) {
    return <Text>Loading...</Text>;
  }

  return (
    <Container size="md" py="xl" ml="xl">
      <Stack gap="xl">
        <Group justify="center" align="center">
          <BookOpen size={32} />
          <Title order={1}>CopilotKit Product Knowledge Base</Title>
        </Group>

        <Grid>
          {posts.map((post) => (
            <Grid.Col key={post.id} span={{ base: 12, sm: 6, md: 4 }}>
              <Card
                shadow="sm"
                padding="lg"
                radius="md"
                withBorder
                onClick={() => handlePostClick(post)}
                style={{ cursor: "pointer" }}
              >
                <Stack gap="md">
                  <Title order={3}>{post.title}</Title>
                  <Badge color="blue" variant="light">
                    {post.category}
                  </Badge>
                  <Text size="sm" c="dimmed">
                    {post.summary}
                  </Text>
                  <Text size="xs" c="dimmed">
                    Posted on: {new Date(post.createdAt).toLocaleDateString()}
                  </Text>
                </Stack>
              </Card>
            </Grid.Col>
          ))}
        </Grid>

        {selectedPost && (
          <Modal
            opened={!!selectedPost}
            onClose={() => setSelectedPost(null)}
            title={selectedPost.title}
            centered
            size="xl"
          >
            <Stack gap="md">
              <List>
                {selectedPost.content
                  .split("\n")
                  .filter((item) => item.trim() !== "")
                  .map((item, index) => (
                    <List.Item key={index}>{item}</List.Item>
                  ))}
              </List>
            </Stack>
          </Modal>
        )}

        <Group justify="center" style={{ width: "100%" }}>
          <Box style={{ flex: 1, maxWidth: "350px" }}>
            <CopilotSidebar
              instructions={`You are a helpful assistant for CopilotKit. When users ask about CopilotKit features or usage:
1. ALWAYS use the FetchKnowledgebaseArticles action immediately to retrieve information
2. Read the content_summary in the response - this contains formatted information about CopilotKit
3. Base your answers directly on the retrieved information 
4. Present the information clearly with specific examples from the knowledge base
5. Always mention specific CopilotKit features and how to use them based on the retrieved data
Never respond with "I couldn't retrieve specific details" as the knowledge base contains comprehensive information about CopilotKit features.`}
              labels={{
                initial:
                  "Welcome! I'm your CopilotKit assistant. Ask me anything about CopilotKit features or how to use it!",
              }}
              defaultOpen={true}
              clickOutsideToClose={false}
            />
          </Box>
        </Group>
      </Stack>
    </Container>
  );
}
