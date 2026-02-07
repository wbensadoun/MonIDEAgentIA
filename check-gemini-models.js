#!/usr/bin/env node

const axios = require('axios');

// Récupérer la clé API depuis les arguments ou l'environnement
const apiKey = process.argv[2] || process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error('❌ Erreur: Veuillez fournir une clé API Gemini');
  console.log('Usage: node check-gemini-models.js VOTRE_CLÉ_API');
  console.log('Ou définissez GEMINI_API_KEY dans votre environnement');
  process.exit(1);
}

console.log('🔍 Vérification des modèles Gemini disponibles...');

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

async function checkModels() {
  try {
    console.log('📡 Appel à l\'API Gemini...');
    const response = await axios.get(url);
    
    if (response.data && response.data.models) {
      console.log(`✅ ${response.data.models.length} modèles trouvés:\n`);
      
      // Filtrer les modèles qui supportent generateContent
      const generateModels = response.data.models.filter(model => 
        model.supportedGenerationMethods && 
        model.supportedGenerationMethods.includes('generateContent')
      );
      
      console.log('📋 Modèles qui supportent generateContent:');
      generateModels.forEach((model, index) => {
        console.log(`${index + 1}. ${model.name} (${model.displayName})`);
        console.log(`   Description: ${model.description}`);
        console.log(`   Méthodes supportées: ${model.supportedGenerationMethods.join(', ')}`);
        console.log('');
      });
      
      // Prendre le dernier modèle qui supporte generateContent
      if (generateModels.length > 0) {
        const lastModel = generateModels[generateModels.length - 1];
        const modelName = lastModel.name.split('/').pop();
        console.log(`🎯 Dernier modèle recommandé: ${modelName}`);
        console.log(`🎯 Nom complet: ${lastModel.name}`);
        console.log(`🎯 Display name: ${lastModel.displayName}`);
        
        // Générer la commande pour mettre à jour le modèle
        console.log(`\n💡 Pour utiliser ce modèle, mettez à jour votre .env:`);
        console.log(`GEMINI_MODEL=${modelName}`);
      } else {
        console.log('❌ Aucun modèle ne supporte generateContent');
      }
    } else {
      console.log('❌ Aucun modèle trouvé dans la réponse');
    }
    
  } catch (error) {
    console.error('❌ Erreur lors de l\'appel à l\'API:');
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Data:`, error.response.data);
    } else if (error.request) {
      console.error('Pas de réponse reçue');
    } else {
      console.error(`Erreur: ${error.message}`);
    }
    process.exit(1);
  }
}

checkModels();
