// Netlify Edge Function - Secure OpenAI Proxy
// Handles image analysis without exposing API key to frontend

export default async (request, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers }
    );
  }

  try {
    // Parse request body
    const body = await request.json();
    const { imageData } = body;

    if (!imageData) {
      return new Response(
        JSON.stringify({ error: 'Image data is required' }),
        { status: 400, headers }
      );
    }

    // Clean base64 data URL prefix if present
    const base64Image = imageData.replace(/^data:image\/\w+;base64,/, '');

    // Validate base64
    if (!base64Image || base64Image.length < 100) {
      return new Response(
        JSON.stringify({ error: 'Invalid image data' }),
        { status: 400, headers }
      );
    }

    // Get API key from Netlify environment variable
    const apiKey = Netlify.env.get('OPENAI_API_KEY');
    
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers }
      );
    }

    // Call OpenAI API
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a waste material analysis expert. Analyze the image and provide:
1. Material type (be specific: PET Plastic, HDPE Plastic, Aluminum, Steel, Glass, Paper, Cardboard, Organic, Electronic, Textile, etc.)
2. Carbon credit value (realistic CO2 kg saved estimate)
3. RE-Points (carbon credit × 10, rounded)
4. 3 creative upcycling suggestions

Respond ONLY in this JSON format:
{
  "material": "specific material name",
  "carbonCredit": number,
  "rePoints": number,
  "upcyclingSuggestions": ["idea 1", "idea 2", "idea 3"]
}`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Analyze this waste material image:'
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: 1000,
        temperature: 0.3,
      }),
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('OpenAI API error:', errorText);
      return new Response(
        JSON.stringify({ error: 'AI analysis failed' }),
        { status: 502, headers }
      );
    }

    const data = await openaiResponse.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return new Response(
        JSON.stringify({ error: 'Empty response from AI' }),
        { status: 502, headers }
      );
    }

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return new Response(
        JSON.stringify({ error: 'Invalid AI response format' }),
        { status: 502, headers }
      );
    }

    const result = JSON.parse(jsonMatch[0]);

    // Return successful response
    return new Response(JSON.stringify(result), { status: 200, headers });

  } catch (error) {
    console.error('Edge function error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', detail: error.message }),
      { status: 500, headers }
    );
  }
};
