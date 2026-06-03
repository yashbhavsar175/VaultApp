import { useEffect } from 'react';
import { StackActions, useNavigation } from '@react-navigation/native';

export function AccountsAndCardsRouteRedirect() {
  const navigation = useNavigation<any>();

  useEffect(() => {
    navigation.dispatch(StackActions.replace('Banks'));
  }, [navigation]);

  return null;
}
