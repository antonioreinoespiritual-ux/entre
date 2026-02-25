import React from 'react';
import { motion } from 'framer-motion';
import { Heart, Clock } from 'lucide-react';

const ResponseMessage = ({ response }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4 }}
      className="bg-white rounded-2xl shadow-lg overflow-hidden border-2 border-rose-100 hover:shadow-xl transition-shadow duration-300"
    >
      <div className="p-6 space-y-4">
        {/* User's feeling */}
        <div className="bg-gradient-to-r from-gray-50 to-rose-50 p-4 rounded-xl">
          <p className="text-gray-700 italic">"{response.userFeeling}"</p>
        </div>

        {/* AI Response */}
        <div className="bg-gradient-to-r from-rose-50 to-amber-50 p-6 rounded-xl border-2 border-rose-200">
          <div className="flex items-start gap-3 mb-3">
            <div className="bg-gradient-to-r from-rose-500 to-amber-500 p-2 rounded-full mt-1">
              <Heart className="w-4 h-4 text-white" fill="white" />
            </div>
            <div className="flex-1">
              <p className="text-gray-800 text-lg font-medium leading-relaxed">
                {response.aiResponse}
              </p>
            </div>
          </div>
        </div>

        {/* Timestamp */}
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <Clock className="w-4 h-4" />
          <span>{response.timestamp}</span>
        </div>
      </div>
    </motion.div>
  );
};

export default ResponseMessage;