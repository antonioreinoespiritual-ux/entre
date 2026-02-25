import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, MessageCircle as MessageCircleHeart, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import ResponseMessage from '@/components/ResponseMessage';
const FeelingInput = () => {
  const [feeling, setFeeling] = useState('');
  const [responses, setResponses] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hopefulResponses = ["Tu corazón sabe la verdad: esa persona volverá cuando esté lista. Mientras tanto, cuídate y brilla.", "El amor verdadero siempre regresa. Dale tiempo al tiempo, y verás cómo vuelven a ti.", "Siente tu dolor, pero también tu fuerza. Esa persona se dará cuenta de lo que perdió y regresará.", "El universo está conspirando a tu favor. Lo que es tuyo por derecho, volverá a ti en el momento perfecto.", "Tu espera no será en vano. El amor que compartieron los guiará de regreso el uno al otro.", "Cada lágrima que derramas hoy, será una sonrisa mañana cuando regresen a tu vida.", "No es un adiós, es un hasta pronto. Mantén tu corazón abierto y la esperanza viva.", "El destino tiene planes hermosos para ti. Esa persona volverá transformada y lista para amarte como mereces."];
  const handleSubmit = e => {
    e.preventDefault();
    if (!feeling.trim()) return;
    setIsSubmitting(true);
    setTimeout(() => {
      const randomResponse = hopefulResponses[Math.floor(Math.random() * hopefulResponses.length)];
      const newResponse = {
        id: Date.now(),
        userFeeling: feeling,
        aiResponse: randomResponse,
        timestamp: new Date().toLocaleString('es-ES', {
          hour: '2-digit',
          minute: '2-digit',
          day: 'numeric',
          month: 'long'
        })
      };
      setResponses(prev => [newResponse, ...prev]);
      setFeeling('');
      setIsSubmitting(false);

      // Save to localStorage
      const savedResponses = JSON.parse(localStorage.getItem('feelingResponses') || '[]');
      localStorage.setItem('feelingResponses', JSON.stringify([newResponse, ...savedResponses].slice(0, 20)));
    }, 1000);
  };

  // Load saved responses on mount
  React.useEffect(() => {
    const saved = localStorage.getItem('feelingResponses');
    if (saved) {
      setResponses(JSON.parse(saved));
    }
  }, []);
  return <motion.section initial={{
    opacity: 0,
    y: 20
  }} animate={{
    opacity: 1,
    y: 0
  }} transition={{
    duration: 0.6,
    delay: 0.4
  }} className="space-y-6">
      <div className="bg-white rounded-3xl shadow-xl overflow-hidden border-2 border-amber-100">
        <div className="bg-gradient-to-r from-amber-500 to-rose-500 p-6">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 backdrop-blur-sm p-3 rounded-full">
              <MessageCircleHeart className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-white">Escríbeme lo que te pasa</h2>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-4">
          <div className="relative">
            <Textarea value={feeling} onChange={e => setFeeling(e.target.value)} placeholder="Escribe lo que sientes en tu corazón... No tengas miedo de expresarte." className="min-h-[150px] text-lg border-2 border-gray-200 focus:border-rose-300 rounded-2xl resize-none transition-all duration-300 focus:ring-4 focus:ring-rose-100" disabled={isSubmitting} />
          </div>

          <Button type="submit" disabled={!feeling.trim() || isSubmitting} className="w-full bg-gradient-to-r from-rose-500 to-amber-500 hover:from-rose-600 hover:to-amber-600 text-white text-lg py-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed">
            {isSubmitting ? <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 animate-spin" />
                <span>Enviando esperanza...</span>
              </div> : <div className="flex items-center gap-2">
                <Send className="w-5 h-5" />
                <span>Enviar y Recibir Dirección</span>
              </div>}
          </Button>
        </form>
      </div>

      {/* Responses */}
      <AnimatePresence>
        {responses.length > 0 && <motion.div initial={{
        opacity: 0
      }} animate={{
        opacity: 1
      }} className="space-y-4">
            <h3 className="text-2xl font-bold text-gray-800 text-center mb-6">
              Mensajes de Esperanza
            </h3>
            {responses.map(response => <ResponseMessage key={response.id} response={response} />)}
          </motion.div>}
      </AnimatePresence>
    </motion.section>;
};
export default FeelingInput;