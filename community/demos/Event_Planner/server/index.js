const express = require("express");
const mongoose = require('mongoose');
const cors = require("cors");
const { CopilotRuntime, GoogleGenerativeAIAdapter } = require("@copilotkit/runtime");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();
const eventRoutes = require('./routes/eventRoutes');

const app = express();
app.use(express.json());
app.use(cors()); // Enables CORS for all routes

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("MongoDB connected"))
  .catch((error) => console.log(error));

// Use routes
app.use('/api/events', eventRoutes);

// Initialize Google Generative AI with your API key
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const copilotKit = new CopilotRuntime();
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
const llmAdapter = new GoogleGenerativeAIAdapter({ model });

// API route to handle CopilotKit responses
app.post('/api/chat', async (req, res) => {
    try {
        let response;

        // Call onBeforeRequest hook
        if (typeof copilotKit.onBeforeRequest === 'function') {
            const beforeResult = await copilotKit.onBeforeRequest(req.body, llmAdapter);
            if (beforeResult) {
                response = beforeResult;
            }
        }

        // If onBeforeRequest didn't provide a response, process the request here
        if (!response) {
            const { message } = req.body; // Extracting the message from the request body
            // console.log("Prompt to model:", message); // Log the input message for debugging

            // Call the Google Generative AI model
            const modelResponse = await model.generateContent(message); // Use message directly as the prompt

            // Assuming the modelResponse structure is consistent with your example
            // console.log('Model response:', modelResponse); // Log the entire response for debugging
            
            // Access the text correctly based on the library's response structure
            if (modelResponse && modelResponse.response && typeof modelResponse.response.text === 'function') {
                const generatedText = modelResponse.response.text(); // Call the text() method
                response = { message: generatedText }; // Set the response to the generated message
            } else {
                response = { message: "No response generated." }; // Fallback message
            }
        }

        // console.log('Response from Gemini:', response); // Log the final response

        // Call onAfterRequest hook
        if (typeof copilotKit.onAfterRequest === 'function') {
            response = await copilotKit.onAfterRequest(response, req.body, llmAdapter);
        }

        res.json(response); // Send the response back to the frontend
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


  
  
// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});