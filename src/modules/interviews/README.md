# Módulo Entrevistas (frontend-only)

## Rutas
- `/projects/:projectId/campaigns/:campaignId/interviews` → Centro de Entrevistas.
- `/projects/:projectId/campaigns/:campaignId/interviews/:sessionId` → Detalle de sesión.

## Estructura principal
- `pages/InterviewCenterPage.jsx`: mini-app con tabs (Dashboard, Clientes, Formularios, Hipótesis, Entrevistas, Análisis semántico).
- `pages/InterviewSessionDetailPage.jsx`: detalle completo de sesión.
- `components/FormBuilder.jsx`: editor estilo Google Forms base con cards de preguntas, acciones por pregunta, preview integrado y estado de guardado.
- `components/InterviewRunner.jsx`: flujo de "Realizar entrevista" en 4 pasos.
- `components/InterviewModuleShell.jsx`: header, tabs, modal y empty states.
- `components/SemanticAnalysisLab.jsx`: laboratorio semántico (clusters, sentimientos, temas, topic modeling heurístico y trazabilidad a evidencia).
- `hooks/useInterviewCenterData.js`: carga reactiva, KPIs y utilidades para mutaciones con feedback.
- `services/interviewsModuleApi.js`: wrapper/adaptador para endpoints existentes de entrevistas.
- `services/semanticAnalysis.js`: utilidades de NLP híbrido frontend-only para análisis de respuestas abiertas sobre el corpus cargado.

## Contratos esperados (sin cambios de backend)
El módulo consume exactamente los endpoints y payloads existentes en `src/services/interviewsApi.js`:
- audiencias de campaña
- CRUD de clientes de entrevistas
- CRUD de hipótesis de entrevistas
- CRUD de formularios de entrevistas
- CRUD de sesiones/entrevistas

No se agregan ni alteran endpoints ni shape de respuestas; el módulo adapta UI al contrato actual.
