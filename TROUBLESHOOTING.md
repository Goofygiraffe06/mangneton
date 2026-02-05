# Troubleshooting RAG Issues

## Recent Fixes Applied ✅

### 1. **Upload Bug Fixed**
- Added missing `onChange` handler to file input
- Files should now actually upload when selected

### 2. **Relevance Threshold Lowered**
- Changed from 0.3 → **0.2** for better recall
- This means more chunks will be considered relevant

### 3. **Debug Logging Added**
Open browser console (F12) to see:
- Query text
- Total chunks in database
- Top 5 similarity scores
- Number of chunks above threshold

### 4. **Success Message Added**
- You'll now see "✅ Document processed successfully!" when upload completes

---

## How to Test Properly

### Step 1: Clear Old Data (if needed)
Open browser console (F12) and run:
```javascript
// Clear all data and reload
indexedDB.deleteDatabase('mangeton_db');
caches.keys().then(keys => keys.forEach(key => caches.delete(key)));
location.reload();
```

### Step 2: Upload a Document
1. Click "Upload Documents"
2. Select a PDF or TXT file
3. Wait for progress bar to complete
4. Look for "✅ Document processed successfully!" message

### Step 3: Ask Questions
1. Type a question related to your document content
2. Press Enter or click Send
3. Check browser console for debug info

---

## Understanding the Debug Output

When you ask a question, check the console:

```
Query: "what is the project name?"
Total chunks: 15
Top scores: ["0.456", "0.389", "0.234", "0.198", "0.156"]
Chunks above threshold (0.2): 4
```

**What this means:**
- **Total chunks**: Number of chunks from all uploaded documents
- **Top scores**: Similarity scores (0-1, higher is better)
  - 0.4+ = Excellent match
  - 0.3-0.4 = Good match
  - 0.2-0.3 = Moderate match
  - <0.2 = Poor match (filtered out)
- **Chunks above threshold**: How many chunks passed the filter

---

## Common Issues & Solutions

### Issue 1: "No relevant information found"

**Possible causes:**
1. Document wasn't uploaded properly
2. Question doesn't match document content
3. Threshold too strict

**Solutions:**
- Check console for "Total chunks" - should be > 0
- Check "Top scores" - if all < 0.2, try rephrasing question
- Make sure document uploaded successfully

### Issue 2: Poor quality answers

**Possible causes:**
1. Similarity scores too low
2. Question too vague
3. Document content doesn't contain answer

**Solutions:**
- Ask more specific questions
- Use keywords from your document
- Check the "Sources Used" section to see what chunks were retrieved

### Issue 3: Upload not working

**Solutions:**
- Make sure file is PDF or TXT
- Check file size (very large files may take time)
- Look for progress bar in sidebar
- Check browser console for errors

---

## Best Practices for Good Results

### ✅ DO:
- Ask specific questions about document content
- Use keywords that appear in your document
- Upload well-formatted documents (clear text, not scanned images)
- Wait for "Document processed successfully!" message

### ❌ DON'T:
- Ask questions about information not in the document
- Use very vague or general questions
- Upload scanned PDFs (text extraction won't work)
- Ask questions before processing completes

---

## Example Good Questions

If you uploaded a project README:
- ✅ "What technologies does this project use?"
- ✅ "How do I install this project?"
- ✅ "What is the main purpose of this application?"

If you uploaded a research paper:
- ✅ "What was the main finding of this study?"
- ✅ "What methodology did the researchers use?"
- ✅ "What are the limitations mentioned?"

---

## Still Having Issues?

1. **Check browser console** (F12) for errors
2. **Clear IndexedDB** and try again
3. **Try a different document** to isolate the issue
4. **Check similarity scores** - if consistently low, document might not be processing correctly

---

## Technical Details

**Current Configuration:**
- Chunk size: 800 words
- Chunk overlap: 100 words
- Top-K: 5 chunks
- Relevance threshold: 0.2
- Max answer tokens: 200
- Temperature: 0.3 (focused)
- Model: flan-t5-small (~80MB)
