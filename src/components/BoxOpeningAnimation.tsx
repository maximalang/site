import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface BoxOpeningAnimationProps {
  prizes: { name: string; image: string }[];
  onComplete: (prize: { name: string; image: string }) => void;
}

const BoxOpeningAnimation: React.FC<BoxOpeningAnimationProps> = ({ prizes, onComplete }) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const [selectedPrize, setSelectedPrize] = useState<{ name: string; image: string } | null>(null);

  const startAnimation = () => {
    setIsAnimating(true);
    setTimeout(() => {
      const randomPrize = prizes[Math.floor(Math.random() * prizes.length)];
      setSelectedPrize(randomPrize);
      setIsAnimating(false);
      onComplete(randomPrize);
    }, 3000);
  };

  return (
    <div className="text-center">
      <motion.div
        animate={isAnimating ? { rotateY: 360 } : {}}
        transition={{ duration: 3, ease: "easeInOut" }}
        className="w-32 h-32 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg mx-auto mb-4 flex items-center justify-center text-white text-2xl font-bold"
      >
        LootBox
      </motion.div>
      <button
        onClick={startAnimation}
        disabled={isAnimating}
        className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      >
        {isAnimating ? 'Opening...' : 'Open Box'}
      </button>
      <AnimatePresence>
        {selectedPrize && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="mt-4"
          >
            <h3 className="text-xl font-semibold text-gray-900 mb-2">You got: {selectedPrize.name}</h3>
            <img src={selectedPrize.image} alt={selectedPrize.name} className="w-24 h-24 mx-auto rounded-lg" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default BoxOpeningAnimation;