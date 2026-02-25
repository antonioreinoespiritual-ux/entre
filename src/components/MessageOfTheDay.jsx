import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

const messages = [
  "Esa persona indiferente, hoy recordará lo valiosa que eres. Tenle paciencia.",
  "El amor verdadero siempre encuentra el camino de regreso. Confía en el proceso.",
  "Cada día que pasa, te vuelves más fuerte y más cerca estás de la felicidad que mereces.",
  "Las tormentas no duran para siempre. Pronto llegará la calma y con ella, el amor renovado.",
  "Tu valor no depende de nadie más. Eres un tesoro que será reconocido.",
  "El universo está trabajando a tu favor. Lo que es tuyo, volverá a ti.",
  "Hoy puede ser difícil, pero mañana será mejor. Mantén la fe en tu corazón.",
  "El tiempo revelará la verdad: eres irreemplazable y alguien lo verá claramente.",
  "No estás perdido/a, estás en un camino de transformación hacia algo hermoso.",
  "Tu luz brilla incluso en la oscuridad. Pronto otros volverán a verla."
];

const MessageOfTheDay = () => {
  const [currentMessage, setCurrentMessage] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    const savedIndex = localStorage.getItem('messageIndex');
    const savedDate = localStorage.getItem('messageDate');
    const today = new Date().toDateString();

    if (savedDate === today && savedIndex) {
      setCurrentMessage(parseInt(savedIndex));
    } else {
      const randomIndex = Math.floor(Math.random() * messages.length);
      setCurrentMessage(randomIndex);
      localStorage.setItem('messageIndex', randomIndex.toString());
      localStorage.setItem('messageDate', today);
    }
  }, []);

  const handleRefresh = () => {
    if (isAnimating) return;
    setIsAnimating(true);
    
    // Small delay to allow exit animation to start
    setTimeout(() => {
      const newIndex = (currentMessage + 1) % messages.length;
      setCurrentMessage(newIndex);
      localStorage.setItem('messageIndex', newIndex.toString());
      setIsAnimating(false);
    }, 600);
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.2 }}
      className="relative"
    >
      <div className="bg-white rounded-3xl shadow-xl overflow-hidden border-2 border-rose-100">
        <div className="bg-gradient-to-r from-rose-500 to-amber-500 p-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-white/20 backdrop-blur-sm p-3 rounded-full">
                <Heart className="w-6 h-6 text-white" fill="white" />
              </div>
              <h2 className="text-2xl font-bold text-white">Lectura del Día</h2>
            </div>
            
            <Button 
              onClick={handleRefresh} 
              className={`
                relative bg-white hover:bg-rose-50 text-rose-600 
                h-16 px-8 rounded-full shadow-[0_0_20px_rgba(255,255,255,0.3)] 
                hover:shadow-[0_0_25px_rgba(255,255,255,0.5)] 
                transition-all duration-300 border-4 border-white/30 
                hover:scale-105 group overflow-hidden
                ${isAnimating ? 'scale-95 bg-rose-50' : ''}
              `}
              disabled={isAnimating}
            >
              <div className="relative z-10 flex items-center gap-3">
                 <span className="font-extrabold bg-gradient-to-r from-rose-600 to-amber-600 bg-clip-text text-transparent text-lg uppercase tracking-wide">
                   Nueva Energía
                 </span>
                 <div className="relative w-12 h-8">
                   {/* Crossed Hearts Design */}
                   <Heart 
                     className={`absolute left-0 top-1/2 -translate-y-1/2 w-7 h-7 text-rose-500 fill-rose-500 drop-shadow-md transition-transform duration-500 
                       ${isAnimating ? 'scale-125 translate-x-3 rotate-0' : '-rotate-12 group-hover:-rotate-45 group-hover:scale-110'}`} 
                   />
                   <Heart 
                     className={`absolute right-0 top-1/2 -translate-y-1/2 w-7 h-7 text-amber-500 fill-amber-500 drop-shadow-md transition-transform duration-500 
                       ${isAnimating ? 'scale-125 -translate-x-3 rotate-0' : 'rotate-12 group-hover:rotate-45 group-hover:scale-110'}`} 
                   />
                 </div>
              </div>
              {/* Shine effect overlay */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-in-out" />
            </Button>
          </div>
        </div>

        <div className="p-8 md:p-12 min-h-[200px] flex items-center justify-center relative overflow-hidden">
          <div className="absolute top-4 right-4 opacity-10">
            <Sparkles className="w-24 h-24 text-rose-400" />
          </div>
          
          <AnimatePresence mode="wait">
            <motion.div
              key={currentMessage}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 1.05 }}
              transition={{ duration: 0.5 }}
              className="relative z-10"
            >
              <p className="text-2xl md:text-3xl text-center font-medium text-gray-800 leading-relaxed">
                "{messages[currentMessage]}"
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="px-8 pb-6 flex justify-center">
          <div className="flex gap-2">
            {messages.map((_, index) => (
              <div
                key={index}
                className={`h-2 rounded-full transition-all duration-300 ${
                  index === currentMessage
                    ? 'w-8 bg-gradient-to-r from-rose-500 to-amber-500'
                    : 'w-2 bg-gray-300'
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </motion.section>
  );
};

export default MessageOfTheDay;