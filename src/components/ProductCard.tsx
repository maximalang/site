import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

interface ProductCardProps {
  id: string;
  name: string;
  price: number;
  description: string;
  image: string;
  rarity?: string;
}

const ProductCard: React.FC<ProductCardProps> = ({ id, name, price, description, image, rarity }) => {
  return (
    <motion.div
      whileHover={{ scale: 1.05, rotateY: 5, rotateX: -5 }}
      transition={{ type: "spring", stiffness: 300 }}
      className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
      style={{ transformStyle: "preserve-3d" }}
    >
      <img src={image} alt={name} className="w-full h-48 object-cover" />
      <div className="p-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">{name}</h3>
        {rarity && <span className="text-sm text-gray-500 mb-2 block">Rarity: {rarity}</span>}
        <p className="text-gray-600 mb-4">{description}</p>
        <div className="flex justify-between items-center">
          <span className="text-xl font-bold text-gray-900">${price}</span>
          <Link
            to={`/product/${id}`}
            className="bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            More Details
          </Link>
        </div>
      </div>
    </motion.div>
  );
};

export default ProductCard;