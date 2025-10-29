import React from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';

interface CartItemProps {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image: string;
  onUpdateQuantity: (id: string, quantity: number) => void;
  onRemove: (id: string) => void;
}

const CartItem: React.FC<CartItemProps> = ({ id, name, price, quantity, image, onUpdateQuantity, onRemove }) => {
  return (
    <div className="flex items-center space-x-4 bg-white p-4 rounded-lg shadow-md">
      <img src={image} alt={name} className="w-16 h-16 object-cover rounded" />
      <div className="flex-1">
        <h3 className="font-semibold text-gray-900">{name}</h3>
        <p className="text-gray-600">${price}</p>
      </div>
      <div className="flex items-center space-x-2">
        <button
          onClick={() => onUpdateQuantity(id, quantity - 1)}
          className="p-1 bg-gray-200 rounded hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <Minus size={16} />
        </button>
        <span className="px-2">{quantity}</span>
        <button
          onClick={() => onUpdateQuantity(id, quantity + 1)}
          className="p-1 bg-gray-200 rounded hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <Plus size={16} />
        </button>
      </div>
      <button
        onClick={() => onRemove(id)}
        className="p-1 text-red-600 hover:text-red-800 focus:outline-none focus:ring-2 focus:ring-red-500"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
};

export default CartItem;