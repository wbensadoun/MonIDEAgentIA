const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

// Calculateur de Similarité Cosinus
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Fonction de Hash pour vérifier si un fichier a été modifié
function getHash(content) {
  return crypto.createHash('md5').update(content, 'utf8').digest('hex');
}

// Découper le texte en blocs chevauchants (chunks) d'environ 1500 caractères
function chunkText(text, chunkSize = 1500, overlap = 200) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    let end = i + chunkSize;
    if (end > text.length) end = text.length;
    chunks.push(text.substring(i, end));
    i += chunkSize - overlap;
  }
  return chunks;
}

class LocalVectorDB {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.indexPath = path.join(projectPath, '.vibe-workspace', 'rag_index.json');
    // Schema: { "filePath": { hash: "...", chunks: [{ text: "...", vector: [...] }] } }
    this.index = {};
  }

  async loadIndex() {
    try {
      const data = await fs.readFile(this.indexPath, 'utf8');
      this.index = JSON.parse(data);
    } catch (e) {
      this.index = {};
    }
  }

  async saveIndex() {
    try {
      await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
      await fs.writeFile(this.indexPath, JSON.stringify(this.index), 'utf8');
    } catch (e) {
      console.error('[RAG] Erreur lors de la sauvegarde de l\'index', e);
    }
  }

  // Appelle l'API Gemini pour obtenir l'embedding (vecteur 768 dimensions)
  async getEmbedding(text, apiKey) {
    if (!apiKey) throw new Error("Clé API manquante pour les embeddings.");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`;
    try {
      const response = await axios.post(url, {
        model: 'models/text-embedding-004',
        content: { parts: [{ text }] }
      });
      return response.data.embedding.values;
    } catch (error) {
      console.error('[RAG] Erreur d\'embedding:', error.response?.data || error.message);
      return null;
    }
  }

  // Synchronise l'index du projet
  async syncProject(filesMap, apiKey) {
    await this.loadIndex();
    let updated = false;
    let newChunksCount = 0;

    for (const [filePath, fileData] of Object.entries(filesMap)) {
      // Ignorer les fichiers binaires ou illisibles
      if (!fileData.content || String(fileData.content).startsWith('[')) continue;
      
      const currentHash = getHash(fileData.content);
      const existingEntry = this.index[filePath];

      // Ne re-calculer que si le fichier a été modifié ou est nouveau
      if (!existingEntry || existingEntry.hash !== currentHash) {
        const chunks = chunkText(fileData.content);
        const embeddedChunks = [];
        
        for (const chunk of chunks) {
          // Ajouter le nom du fichier au début du chunk pour plus de contexte sémantique
          const contextualChunk = `Fichier: ${filePath}\n${chunk}`;
          const vector = await this.getEmbedding(contextualChunk, apiKey);
          if (vector) {
            embeddedChunks.push({ text: contextualChunk, vector });
            newChunksCount++;
          }
          // Petite pause pour ne pas saturer l'API
          await new Promise(r => setTimeout(r, 100));
        }

        this.index[filePath] = { hash: currentHash, chunks: embeddedChunks };
        updated = true;
      }
    }

    if (updated) {
      console.log(`[RAG] Synchronisation terminée. ${newChunksCount} nouveaux blocs indexés.`);
      await this.saveIndex();
    }
    return newChunksCount;
  }

  // Recherche sémantique
  async search(query, topK, apiKey) {
    await this.loadIndex();
    const queryVector = await this.getEmbedding(query, apiKey);
    if (!queryVector) return [];

    const results = [];
    for (const [filePath, entry] of Object.entries(this.index)) {
      for (const chunk of entry.chunks) {
        const score = cosineSimilarity(queryVector, chunk.vector);
        results.push({ filePath, text: chunk.text, score });
      }
    }

    // Trier par pertinence décroissante
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }
}

module.exports = { LocalVectorDB };
