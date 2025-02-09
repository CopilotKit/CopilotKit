package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"github.com/sashabaranov/go-openai"
)

func main() {
	apiKey := "your-api-key-here" // Replace with your actual API key
	client := openai.NewClient(apiKey)

	reader := bufio.NewReader(os.Stdin)

	for {
		fmt.Print("You: ")
		userInput, _ := reader.ReadString('\n')
		userInput = strings.TrimSpace(userInput)

		if userInput == "exit" || userInput == "quit" || userInput == "bye" {
			fmt.Println("AI: Goodbye!")
			break
		}

		resp, err := client.CreateChatCompletion(
			openai.ChatCompletionRequest{
				Model: openai.GPT3Dot5Turbo,
				Messages: []openai.ChatCompletionMessage{
					{Role: "system", Content: "You are a helpful AI assistant."},
					{Role: "user", Content: userInput},
				},
			},
		)
		if err != nil {
			fmt.Println("Error:", err)
			continue
		}

		fmt.Println("AI:", resp.Choices[0].Message.Content)
	}
}
