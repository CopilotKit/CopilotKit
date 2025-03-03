"use client"

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
import { useCopilotAction } from "@copilotkit/react-core";

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

  useCopilotAction({
    name: "FetchKnowledgebaseArticles",
    description: "Fetch relevant knowledge base articles based on a user query",
    parameters: [
      {
        name: "query",
        type: "string",
        description: "User query for the knowledge base",
        required: true,
      },
    ],

      handler: async ({ query }: { query: string }) => {
        console.log(query)
      },   
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
              instructions="Help the user get the right knowledge base articles for their query"
              labels={{
                initial: "Welcome! Describe the query you need assistance with.",
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
