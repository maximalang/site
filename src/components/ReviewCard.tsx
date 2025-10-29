import React from 'react';

interface ReviewCardProps {
  name: string;
  avatar: string;
  rating: number;
  review: string;
}

const ReviewCard: React.FC<ReviewCardProps> = ({ name, avatar, rating, review }) => {
  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center mb-4">
        <img src={avatar} alt={name} className="w-12 h-12 rounded-full mr-4" />
        <div>
          <h4 className="font-semibold text-gray-900">{name}</h4>
          <div className="flex">
            {[...Array(5)].map((_, i) => (
              <span key={i} className={`text-lg ${i < rating ? 'text-yellow-400' : 'text-gray-300'}`}>★</span>
            ))}
          </div>
        </div>
      </div>
      <p className="text-gray-600">{review}</p>
    </div>
  );
};

export default ReviewCard;