#!/usr/bin/env node

/**
 * CLI Orchestrateur Local (Ollama + Agents)
 * But : Économiser des tokens en utilisant des modèles locaux pour l'orchestration et la lecture,
 * et réserver les modèles distants (ou locaux spécifiques) pour le code.
 */

const OLLAMA_URL = 'http://localhost:11434/api/chat';
const OLLAMA_MODEL = 'llama3'; // ou 'qwen2.5-coder', 'mistral', etc.

async function askAgent(role, systemPrompt, userMessage) {
    console.log(`\n🤖 [Agent ${role}] réfléchit...`);
    
    try {
        const response = await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ],
                stream: false
            })
        });

        const data = await response.json();
        return data.message.content;
    } catch (error) {
        console.error(`Erreur avec l'agent ${role}:`, error.message);
        return null;
    }
}

async function main() {
    const args = process.argv.slice(2);
    const task = args.join(' ');

    if (!task) {
        console.log('❌ Veuillez fournir une tâche. Ex: node ollama-orchestrator.js "Analyse le fichier main.js"');
        process.exit(1);
    }

    console.log(`\n🎯 Tâche reçue : "${task}"\n`);

    // 1. Agent Orchestrateur
    const orchestratorPrompt = "Tu es le manager. Divise la tâche de l'utilisateur en 2 étapes max : 1. Ce qu'il faut lire/explorer. 2. Ce qu'il faut coder. Sois très bref.";
    const plan = await askAgent('Orchestrateur', orchestratorPrompt, task);
    console.log(`\n📋 Plan d'action :\n${plan}`);

    // 2. Agent Explorateur
    const explorerPrompt = "Tu es l'explorateur. Basé sur le plan, dis-moi exactement quels fichiers tu as besoin de lire ou quelles recherches tu dois faire. Retourne juste une liste de fichiers.";
    const exploration = await askAgent('Explorateur', explorerPrompt, `Plan actuel : ${plan}\nTâche : ${task}`);
    console.log(`\n🔍 Fichiers à analyser :\n${exploration}`);

    // 3. Agent Coder (Ici on utilise Ollama aussi pour économiser, mais on pourrait appeler l'API Together AI)
    const coderPrompt = "Tu es l'expert en code. Basé sur la tâche, génère le code demandé. Ne renvoie QUE du code, sans explications inutiles.";
    const code = await askAgent('Coder', coderPrompt, `Tâche : ${task}\nContexte : ${exploration}`);
    console.log(`\n💻 Code généré :\n${code}\n`);
}

main();
